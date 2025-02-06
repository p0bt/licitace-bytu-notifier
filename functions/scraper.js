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
    let lastLink = null;  // To store the last found link

    rows.forEach(row => {
      const sizeMatch = row.match(/(\d\+\d)/);  // Matches sizes like 0+1, 1+3, etc.
      const dateMatch = row.match(/\d{2}\.\d{2}\.\d{4}/);  // Matches dates like 17.02.2025

      // Check for the link in the row
      const linkMatch = row.match(/href="([^"]+)"/);  // Matches URLs in anchor tags (href="...")
      if (linkMatch) {
        lastLink = linkMatch[1];  // Save the last found link
      }

      // If a size is found, update the lastSize
      if (sizeMatch) {
        lastSize = sizeMatch[0];
      }

      // If a date is found and a size is available, create an entry
      if (dateMatch && lastSize && lastLink) {
        const entry = {
          size: lastSize,
          description: row,
          date: dateMatch[0],
          link: lastLink, // Add the link to the entry
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
    subject: 'Nové licitace pro vás!',
    html: `
      <h1>Nové licitace nalazeny (o velikosti 3+1 a více):</h1>
      <table style="border-collapse: collapse; width: 100%; margin-top: 20px; border: 1px solid #ddd;">
        <thead>
          <tr>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Velikost bytu</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Popis</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Odkaz</th>
          </tr>
        </thead>
        <tbody>
          ${newData
            .map(entry => {
              // Create a full URL for the link
              const fullUrl = `https://www.mesto-bohumin.cz/${entry.link}`;
              return `
                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">${entry.size}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${entry.description}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">
                    <a href="${fullUrl}" title="Klikněte pro více informací" style="color: #0066cc;">Licitace Detail</a>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `,
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

  if (JSON.stringify(currentData) !== JSON.stringify(previousData)) {
    // Check if any 'size' value matches the target sizes
    const relevantNewEntries = currentData.filter(entry => TARGET_SIZES.includes(entry.size));
  
    if (relevantNewEntries.length > 0) {
      await sendEmailNotification(relevantNewEntries);
      emailSent = true;
    }
  }
  

  // Save the new data
  saveDataToFile(currentData);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Scraper executed', emailSent, data: currentData }),
  };
};