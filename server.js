// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');
const mysql = require('mysql2');

// Express setup
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(accountSid, authToken);

// MySQL connection pool
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Connected to MySQL');
    connection.release();
  }
});

// Route 1: Send OTP
app.post('/send-otp', async (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number required' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP

  try {
    await client.messages.create({
      body: `Your OTP is: ${otp}`,
      from: twilioNumber,
      to: `+91${mobileNumber}`,
    });

    // Save OTP to database (or update if already exists)
    db.query(
      'INSERT INTO otp_store (mobile_number, otp, created_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE otp = ?, created_at = NOW()',
      [mobileNumber, otp, otp],
      (err, result) => {
        if (err) {
          console.error('DB Error:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, message: 'OTP sent successfully' });
      }
    );
  } catch (error) {
    console.error('Twilio Error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP', error: error.message });
  }
});

// Route 2: Verify OTP and save user
app.post('/verify-otp', (req, res) => {
  const { name, email, mobileNumber, password, otp } = req.body;

  if (!name || !email || !mobileNumber || !password || !otp) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  // Check OTP in database
  db.query(
    'SELECT otp FROM otp_store WHERE mobile_number = ?',
    [mobileNumber],
    (err, results) => {
      if (err) {
        console.error('DB Error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(400).json({ success: false, message: 'OTP not found' });
      }

      if (results[0].otp === otp) {
        // OTP matches, save user
        db.query(
          'INSERT INTO users (name, email, mobile_number, password) VALUES (?, ?, ?, ?)',
          [name, email, mobileNumber, password], // ⚠️ Hash passwords in production!
          (err2, result2) => {
            if (err2) {
              console.error('DB Error:', err2);
              return res.status(500).json({ success: false, message: 'Failed to register user' });
            }

            // Delete OTP after successful verification
            db.query('DELETE FROM otp_store WHERE mobile_number = ?', [mobileNumber]);

            res.json({ success: true, message: 'OTP verified and user registered successfully' });
          }
        );
      } else {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
      }
    }
  );
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
