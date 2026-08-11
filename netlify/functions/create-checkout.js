const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { amount, donorName, email, chapter, address, city, zip, shippingFee } = JSON.parse(event.body);
        const origin = event.headers.origin || event.headers.referer;

        // 1. Create the base donation item
        const lineItems = [{
            price_data: {
                currency: 'usd',
                product_data: {
                    name: 'Sunday of Good Hope Donation',
                    description: 'Kappa Alpha Psi - Palo Alto Alumni Chapter'
                },
                unit_amount: amount * 100,
            },
            quantity: 1,
        }];

        // 2. Add the shipping fee item (only if they checked the box)
        if (shippingFee > 0) {
            lineItems.push({
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Shipping & Handling',
                        description: 'Commemorative Coin Delivery'
                    },
                    unit_amount: shippingFee * 100,
                },
                quantity: 1,
            });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: email, 
            line_items: lineItems, 
            mode: 'payment',
            success_url: `${origin}?success=true`,
            cancel_url: `${origin}`,
            // We pass the pure donation amount so the webhook knows what to track!
            metadata: {
                donorName: donorName,
                chapter: chapter,
                shippingAddress: address,
                shippingCity: city,
                shippingZip: zip,
                pureDonationAmount: amount
            }
        });

        return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
