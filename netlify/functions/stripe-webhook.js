const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');
const nodemailer = require('nodemailer'); 

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
        })
    });
}
const db = admin.firestore();

exports.handler = async (event) => {
    const sig = event.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let stripeEvent;

    try {
        stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook Error:', err.message);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        const meta = session.metadata;
        
        // Use the pure donation amount for the tracker!
        const baseDonationAmount = parseFloat(meta.pureDonationAmount); 
        const totalCharged = session.amount_total / 100;
        const shippingPaid = totalCharged - baseDonationAmount;

        try {
            // TASK A: Update the Progress Bar Total (Using BASE donation)
            const totalRef = db.collection('fundraiser').doc('test_totals');
            await totalRef.set({
                amountRaised: admin.firestore.FieldValue.increment(baseDonationAmount)
            }, { merge: true });
            
            // TASK B: Save the Donor's Info
            await db.collection('donors').add({
                name: meta.donorName,
                email: session.customer_details?.email || "Unknown",
                chapter: meta.chapter,
                donationAmount: baseDonationAmount,
                totalPaid: totalCharged,
                qualifiesForCoin: baseDonationAmount >= 30 && meta.shippingAddress !== "N/A",
                shippingAddress: meta.shippingAddress,
                shippingCity: meta.shippingCity,
                shippingZip: meta.shippingZip,
                date: admin.firestore.FieldValue.serverTimestamp(),
                stripeTransactionId: session.id
            });

            // TASK C: SEND EMAILS
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER, 
                    pass: process.env.EMAIL_PASS  
                }
            });

            // 1. Admin Email
            const adminEmailHtml = `
                <h2>New Donation Received!</h2>
                <p><strong>Name:</strong> ${meta.donorName}</p>
                <p><strong>Donation:</strong> $${baseDonationAmount.toFixed(2)}</p>
                ${shippingPaid > 0 ? `<p><strong>Shipping Paid:</strong> $${shippingPaid.toFixed(2)}</p>` : ``}
                <p><strong>Chapter Affiliation:</strong> ${meta.chapter}</p>
                <hr>
                <h3>Shipping Details:</h3>
                <p>${meta.shippingAddress}</p>
                <p>${meta.shippingCity}, ${meta.shippingZip}</p>
            `;

            await transporter.sendMail({
                from: `"PAAC Notifications" <${process.env.EMAIL_USER}>`,
                to: process.env.ADMIN_EMAIL_TO, 
                subject: `New $${baseDonationAmount} Donation from ${meta.donorName}`,
                html: adminEmailHtml
            });

            // 2. Donor Receipt
            const donorEmailHtml = `
                <h2>Thank you, ${meta.donorName}!</h2>
                <p>On behalf of the Palo Alto Alumni Chapter of Kappa Alpha Psi and St. Jude Children's Research Hospital, thank you for your generous gift.</p>
                <p><strong>Donation Amount:</strong> $${baseDonationAmount.toFixed(2)}</p>
                ${shippingPaid > 0 ? `<p><strong>Shipping Fee:</strong> $${shippingPaid.toFixed(2)}</p>` : ``}
                <p><strong>Total Charged:</strong> $${totalCharged.toFixed(2)}</p>
                
                ${shippingPaid > 0 
                    ? `<br><p><strong>Coin Status:</strong> We have received your shipping fee and address. Your Klassic Kappa Commemorative Coin will be shipped shortly!</p>` 
                    : ``}
                <br>
                <p>With gratitude,<br>Palo Alto Alumni Chapter</p>
            `;

            await transporter.sendMail({
                from: `"Palo Alto Alumni Chapter" <${process.env.EMAIL_USER}>`,
                to: session.customer_details.email,
                subject: 'Thank You for your Sunday of Good Hope Donation!',
                html: donorEmailHtml
            });

        } catch (err) {
            console.error('Error in Database or Email:', err);
            return { statusCode: 500, body: 'Process failed' };
        }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
