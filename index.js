const { MongoClient, ServerApiVersion, Admin } = require('mongodb');

const express = require('express');
var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');
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


// -------------------- JSON WEB TOEKN 
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



// -------------------- SEND APPOINTMENT CONFIRMATION EMAIL THEOUGH SEND GRID  
var emailSenderOption = {
    auth: {
        api_key: process.env.SEND_GRID_KEY
    }
}
var emailClient = nodemailer.createTransport(sgTransport(emailSenderOption));


function sendAppointmentEmail(booking) {
    const { treatment, date, slot, patientEmail, patientName } = booking;
    var email = {
        from: process.env.EMAIL_FROM,
        to: patientEmail,
        subject: `Your  appointment for ${treatment} on ${date} at ${slot} is confirmed.`,
        text: `Your  appointment for ${treatment} on ${date} at ${slot} is confirmed.`,
        html: `
        <div> 
        <h3>Hello ${patientName},</h3>
        <p>Your appointment has been confirm ${treatment}.</p>
        <p>Looking forward to seeing on ${date} at ${slot}</p>
        <p>Paitent name: ${patientName}</p>
        <p>Address: Jalan SS 7/26, Kelana Jaya, 47301, Selangor
        </p>
        <a href="https://www.facebook.com/ahan.bryan.96/">Unsubscribe</a>
        </div>
        `
    };

    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent');
        }
    });

}


async function run() {
    try {
        await client.connect();
        const servicesCollection = client.db('dorctors_portal').collection('services');
        const bookingCollection = client.db('dorctors_portal').collection('booking');
        const usersCollection = client.db('dorctors_portal').collection('users');
        const doctorsCollection = client.db('dorctors_portal').collection('doctors');


        const verifyAdmin = async (req, res, next) => {
            const requestUserEmail = req.decoded.email;
            const requesterAccount = await usersCollection.findOne({ email: requestUserEmail })
            if (requesterAccount.role === 'admin') {
                next()
            }
            else {
                return res.status(403).send({ message: 'Forbidden access' })
            }
        }



        // -------------------- SERVICE --------------------

        // -------------------- GET ALL SERVICES 
        app.get('/services', async (req, res) => {
            const query = {};
            const cursor = servicesCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray(cursor);
            res.send(services)
        })



        // -------------------- USER --------------------

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



        // -------------------- ADMIN --------------------

        // -------------------- GET ADMIN BY EMAIL 
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email })
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })
        })

        // -------------------- MAKE ADMIN
        app.put('/users/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        })



        // -------------------- DOCTOR --------------------



        // -------------------- GET ALL DOCTORS 
        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorsCollection.find().toArray();
            res.send(doctors);
        })

        // -------------------- ADD NEW DOCOTR 
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        })

        // -------------------- DELETE A DOCTOR BY USING PARAMS (EMAIL)
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const deleteDelete = await doctorsCollection.deleteOne(query);
            res.send(deleteDelete);
        })



        // -------------------- AVAILABLE --------------------

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




        // -------------------- BOOKING --------------------

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
            sendAppointmentEmail(booking);
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