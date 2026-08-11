const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');
const nodemailer = require('nodemailer'); // NEW EMAIL IMPORT

// 1. Log into Firebase securely as an Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // The replace function fixes the line breaks for Netlify's secure vault
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
        })
    });
}
const db = admin.firestore();

exports.handler = async (event) => {
    // 2. Verify that this message actually came from Stripe and not a hacker
    const sig = event.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let stripeEvent;

    try {
        stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook Error:', err.message);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    // 3. If it's a successful checkout, update the database!
    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        const amountDonated = session.amount_total / 100; 
        
        // Grab the hidden metadata we passed earlier
        const meta = session.metadata;

        try {
            // TASK A: Update the Progress Bar Total
            const totalRef = db.collection('fundraiser').doc('test_totals');
            await totalRef.set({
                amountRaised: admin.firestore.FieldValue.increment(amountDonated)
            }, { merge: true });
            
            // TASK B: Save the Donor's Info for Fulfillment
            await db.collection('donors').add({
                name: meta.donorName,
                email: session.customer_details?.email || "Unknown",
                chapter: meta.chapter,
                amount: amountDonated,
                qualifiesForCoin: amountDonated >= 30,
                shippingAddress: meta.shippingAddress,
                shippingCity: meta.shippingCity,
                shippingZip: meta.shippingZip,
                date: admin.firestore.FieldValue.serverTimestamp(),
                stripeTransactionId: session.id
            });
            console.log(`Successfully added $${amountDonated} to Firebase.`);

            // ==========================================
            // TASK C: SEND THE AUTOMATED EMAILS
            // ==========================================
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER, // The Gmail address sending the emails
                    pass: process.env.EMAIL_PASS  // The 16-digit App Password
                }
            });

            // 1. Email to the Chapter (Admin Notification)
            const adminEmailHtml = `
                <h2>New Donation Received!</h2>
                <p><strong>Name:</strong> ${meta.donorName}</p>
                <p><strong>Amount:</strong> $${amountDonated.toFixed(2)}</p>
                <p><strong>Chapter Affiliation:</strong> ${meta.chapter}</p>
                <p><strong>Qualifies for Coin?</strong> ${amountDonated >= 30 ? "YES" : "NO"}</p>
                <hr>
                <h3>Shipping Details:</h3>
                <p>${meta.shippingAddress}</p>
                <p>${meta.shippingCity}, ${meta.shippingZip}</p>
            `;

            await transporter.sendMail({
                from: `"PAAC Notifications" <${process.env.EMAIL_USER}>`,
                to: process.env.ADMIN_EMAIL_TO, // Who should receive the notification?
                subject: `New $${amountDonated} Donation from ${meta.donorName}`,
                html: adminEmailHtml
            });

            // 2. Email to the Donor (Thank You Receipt)
            const donorEmailHtml = `
                <h2>Thank you, ${meta.donorName}!</h2>
                <p>On behalf of the Palo Alto Alumni Chapter of Kappa Alpha Psi and St. Jude Children's Research Hospital, thank you for your generous gift of <strong>$${amountDonated.toFixed(2)}</strong>.</p>
                <p>Your contribution helps ensure families never receive a bill for treatment, travel, housing, or food.</p>
                ${amountDonated >= 30 
                    ? `<p><strong>Coin Status:</strong> Your donation qualifies for the Klassic Kappa Commemorative Coin! We have received your shipping address and will process it shortly.</p>` 
                    : ``}
                <br>
                <p>With gratitude,<br>Palo Alto Alumni Chapter</p>
            `;

            await transporter.sendMail({
                from: `"Palo Alto Alumni Chapter" <${process.env.EMAIL_USER}>`,
                to: session.customer_details.email, // Sends directly to the donor's email
                subject: 'Thank You for your Sunday of Good Hope Donation!',
                html: donorEmailHtml
            });

            console.log("Emails sent successfully!");

        } catch (err) {
            console.error('Error in Database or Email:', err);
            return { statusCode: 500, body: 'Process failed' };
        }
    }

    // Tell Stripe we received the message successfully
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
