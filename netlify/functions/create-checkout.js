// This securely imports Stripe using our hidden Secret Key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
    // We only accept POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Parse the data sent from your HTML file
        const { amount, donorName } = JSON.parse(event.body);
        
        // Find out the URL of the website so Stripe knows where to send them back
        const origin = event.headers.origin || event.headers.referer;

        // Tell Stripe to generate a secure checkout page
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Sunday of Good Hope Donation',
                        description: 'Kappa Alpha Psi - Palo Alto Alumni Chapter'
                    },
                    unit_amount: amount * 100, // Stripe calculates everything in pennies! ($30 = 3000 pennies)
                },
                quantity: 1,
            }],
            mode: 'payment',
            // If they pay successfully, send them back to the website with a "success=true" tag
            success_url: `${origin}?success=true`,
            // If they hit the back button, send them back to the normal website
            cancel_url: `${origin}`,
        });

        // Send the secure Stripe URL back to the frontend
        return {
            statusCode: 200,
            body: JSON.stringify({ url: session.url })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};