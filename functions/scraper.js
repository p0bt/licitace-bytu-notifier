const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const URL = 'https://www.mesto-bohumin.cz/cz/radnice/byty-nebyty-nemovitosti/licitace-bytu';
const TARGET_SIZES = ['1+3', '3+1', '1+4', '4+1', '1+5', '5+1'];
const JSON_FILE = path.join('/tmp', 'licitace_data.json');  // Use /tmp for Netlify function storage

// Configure email transporter (replace with your email credentials)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,  // Set these in Netlify environment variables
    pass: process.env.EMAIL_PASS,
  },
});

async function fetchData() {
  try {
    const { data } = await axios.get(URL);
    const $ = cheerio.load(data);
    const rows = $('body').text().split('\n').map(row => row.trim()).filter(row => row.length > 0);

    const results = [];
    let lastSize = null;  // To store the most recent size value

    rows.forEach(row => {
      const sizeMatch = row.match(/(\d\+\d)/);  // Matches sizes like 0+1, 1+3, etc.
      const dateMatch = row.match(/\d{2}\.\d{2}\.\d{4}/);  // Matches dates like 17.02.2025

      if (sizeMatch) {
        lastSize = sizeMatch[0];  // Update last seen size
      }

      if (dateMatch) {
        const entry = {
          size: lastSize,
          description: row,
          date: dateMatch[0],
        };
        results.push(entry);
      }
    });

    return results;
  } catch (error) {
    console.error('Error fetching the data:', error);
    return [];
  }
}

function saveDataToFile(data) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2));
}

function loadPreviousData() {
  if (fs.existsSync(JSON_FILE)) {
    const rawData = fs.readFileSync(JSON_FILE);
    return JSON.parse(rawData);
  }
  return null;
}

async function sendEmailNotification(newData) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'jennypeta732@gmail.com',
    subject: 'New Property Listing Detected!',
    text: `New listings found: \n\n${JSON.stringify(newData, null, 2)}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

exports.handler = async function (event, context) {
  console.log('Scraper triggered via Netlify function');

  const currentData = await fetchData();
  const previousData = loadPreviousData();

  let emailSent = false;

  if (previousData) {
    // Check for differences
    const hasChanges = JSON.stringify(currentData) !== JSON.stringify(previousData);

    if (hasChanges) {
      // Check if any 'size' value matches the target sizes
      const relevantNewEntries = currentData.filter(entry => TARGET_SIZES.includes(entry.size));

      if (relevantNewEntries.length > 0) {
        await sendEmailNotification(relevantNewEntries);
        emailSent = true;
      }
    }
  }

  // Save the new data
  saveDataToFile(currentData);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Scraper executed', emailSent, data: currentData }),
  };
};