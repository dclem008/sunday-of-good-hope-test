// This securely imports Stripe using our hidden Secret Key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
    // We only accept POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Parse ALL the data sent from your HTML file
        const { amount, donorName, email, chapter, address, city, zip } = JSON.parse(event.body);
        const origin = event.headers.origin || event.headers.referer;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: email, // This auto-fills their email on the Stripe screen!
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Sunday of Good Hope Donation',
                        description: 'Kappa Alpha Psi - Palo Alto Alumni Chapter'
                    },
                    unit_amount: amount * 100,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${origin}?success=true`,
            cancel_url: `${origin}`,
            // METADATA: This is where Stripe securely holds the info until they pay!
            metadata: {
                donorName: donorName,
                chapter: chapter,
                shippingAddress: address,
                shippingCity: city,
                shippingZip: zip
            }
        });

        return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
