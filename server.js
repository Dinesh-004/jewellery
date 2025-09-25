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

app.get('/', (req, res) => {
  res.send('Hello, World!');
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

// verify OTP route (just verify)
app.post('/verify-otp', (req, res) => {
  const { mobileNumber, otp } = req.body;

  if (!mobileNumber || !otp) {
    return res.status(400).json({ success: false, message: 'Mobile number and OTP required' });
  }

  db.query(
    'SELECT otp FROM otp_store WHERE mobile_number = ?',
    [mobileNumber],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });

      if (results.length === 0 || results[0].otp !== otp) {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
      }

      res.json({ success: true, message: 'OTP verified successfully' });
    }
  );
});

// register user route (after OTP verified)
app.post('/register-user', (req, res) => {
  const { name, email, mobileNumber, password } = req.body;

  if (!name || !email || !mobileNumber || !password) {
    return res.status(400).json({ success: false, message: 'All fields required' });
  }

  // Check if mobile number already exists
  db.query('SELECT id FROM users WHERE mobile_number = ?', [mobileNumber], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (results.length > 0) return res.status(400).json({ success: false, message: 'Mobile number already registered' });

    // Insert user
    db.query(
      'INSERT INTO users (name, email, mobile_number, password) VALUES (?, ?, ?, ?)',
      [name, email, mobileNumber, password], // ⚠️ hash password in production
      (err2, result2) => {
        if (err2) return res.status(500).json({ success: false, message: 'Failed to register user' });

        // Delete OTP after registration
        db.query('DELETE FROM otp_store WHERE mobile_number = ?', [mobileNumber]);

        res.json({ success: true, message: 'User registered successfully' });
      }
    );
  });
});

app.post('/login', (req, res) => {
  const { mobileNumber, password } = req.body;

  if (!mobileNumber || !password) {
    return res.status(400).json({ success: false, message: 'Mobile and password required' });
  }

  db.query(
    'SELECT * FROM users WHERE mobile = ? AND password = ?',
    [mobileNumber, password],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error', err });

      if (result.length > 0) {
        return res.json({ success: true, message: 'Login successful', user: result[0] });
      } else {
        return res.status(401).json({ success: false, message: 'Invalid mobile or password' });
      }
    }
  );
});

app.post('/forgot/reset-password', (req, res) => {
  const { mobileNumber, newPassword } = req.body;

  if (!mobileNumber || !newPassword) {
    return res.status(400).json({ success: false, message: 'Mobile number and new password required' });
  }

  const sql = 'UPDATE users SET password = ? WHERE mobile = ?';
  db.query(sql, [newPassword, mobileNumber], (err, result) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ success: false, message: 'Database error', error: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Password reset successfully ✅' });
  });
});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
