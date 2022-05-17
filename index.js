const { MongoClient, ServerApiVersion, Admin } = require('mongodb');

const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();
var jwt = require('jsonwebtoken');


// Middleware 
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bu6rg.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });



function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unathorized access' })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.SECRET_TOKEN, function (err, decoded) {

        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next()
    });
}


async function run() {
    try {
        await client.connect();
        const servicesCollection = client.db('dorctors_portal').collection('services');
        const bookingCollection = client.db('dorctors_portal').collection('booking');
        const usersCollection = client.db('dorctors_portal').collection('users');


        // -------------------- GET ALL SERVICES 
        app.get('/services', async (req, res) => {
            const query = {};
            const cursor = servicesCollection.find(query);
            const services = await cursor.toArray(cursor);
            res.send(services)
        })

        // -------------------- GET ALL USERS
        app.get('/users', verifyJWT, async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users)
        })



        // -------------------- USER Email update 
        app.put('/users/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            var token = jwt.sign({ email: email },
                process.env.SECRET_TOKEN,
                { expiresIn: '1d' }
            );
            res.send({ result, accessToken: token })
        })


        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email })
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })
        })

        // -------------------- MAKE ADMIN
        app.put('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requestUserEmail = req.decoded.email;
            const requesterAccount = await usersCollection.findOne({ email: requestUserEmail })

            if (requesterAccount.role === 'admin') {
                const filter = { email: email };
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await usersCollection.updateOne(filter, updateDoc);
                res.send(result)
            }
            else {
                return res.status(403).send({ message: 'Forbidden access' })
            }
        })


        // --------------------GET ALL THE AVAILABLE SLOTS 
        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // Step 1 - get all ther services
            const services = await servicesCollection.find().toArray();

            // Step 2 - get the booking of that date
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // Step 3 - for each services, find booking for that service
            services.forEach(service => {
                const serviceBooking = bookings.filter(book => book.treatment === service.name);
                const bookedSlots = serviceBooking.map(book => book.slot);
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                service.slots = available;
            });
            res.send(services)
        })


        // -------------------- GET ALL THE BOOKING SLOT FROM SPECIFIC USER 
        app.get('/booking', verifyJWT, async (req, res) => {
            const patientEmail = req.query.patientEmail;
            const decodedEmail = req.decoded.email;

            if (patientEmail === decodedEmail) {
                const query = { patientEmail: patientEmail };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings)
            }
            else {
                return res.status(403).send({ message: 'Forbidden access' })
            }
        })

        // -------------------- ADD NEW BOOKING SLOT TO THE BOOKING API 
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patientEmail: booking.patientEmail }
            const existBooking = await bookingCollection.findOne(query)
            if (existBooking) {
                return res.send({ success: false, booking: existBooking })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send({ success: true, result })

        })

    }

    finally {

    }
}
run().catch(console.dir)


app.get('/', (req, res) => {
    res.send("Doctors portal")
})

app.listen(port, () => {
    console.log(`Doctors portal running ${port}`)
})