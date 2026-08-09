const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

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
            // This creates a brand new document in a collection called "donors"
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

            console.log(`Success! Added $${amountDonated} and saved donor: ${meta.donorName}`);
        } catch (err) {
            console.error('Error updating Firebase:', err);
            return { statusCode: 500, body: 'Firebase update failed' };
        }
    }

    // Tell Stripe we received the message successfully
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
