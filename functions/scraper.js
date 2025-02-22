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
    const { data } = await axios.get(URL, { responseEncoding: 'utf8' });
    const $ = cheerio.load(data);
    
    // Select all <p> tags and iterate through them
    const results = [];
    let lastSize = null;
    let lastLink = null;
    
    $('p').each((i, p) => {
      const text = $(p).text().trim();  // Get the entire text from the paragraph
      const sizeMatch = text.match(/(\d\+\d)/);  // Matches sizes like 0+1, 1+3, etc.
      const dateMatch = text.match(/\d{2}\.\d{2}\.\d{4}/);  // Matches dates like 17.02.2025
      const linkMatch = $(p).find('a').attr('href');  // Extract the link (href attribute)
      
      // If a link is found, update lastLink
      if (linkMatch) {
        lastLink = linkMatch;
      }

      // Remove the <a> part from the description (the title link)
      $(p).find('a').remove();  // This will remove the <a> tag and its contents from the paragraph

      // Now the text in the paragraph will be cleaned of the <a> tag
      const cleanedDescription = $(p).text().trim();  // Cleaned text without <a> tag

      // If size is found, update lastSize
      if (sizeMatch) {
        lastSize = sizeMatch[0];
      }

      // If date is found and both size and link are present, create an entry
      if (dateMatch && lastSize && lastLink) {
        const entry = {
          size: lastSize,
          description: cleanedDescription,  // Use the cleaned description
          date: dateMatch[0],
          link: `https://www.mesto-bohumin.cz/${lastLink}`,  // Full URL for the link
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
    to: 'pbutora1@seznam.cz',
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

  if (previousData) {
    // Check if there are any differences
    const hasChanges = JSON.stringify(currentData) !== JSON.stringify(previousData);

    console.log("HAS CHANGES:"+hasChanges)
  
    if (hasChanges) {
      // Find only the new unique offers that aren't in previousData
      const newEntries = currentData.filter(entry => 
        !previousData.some(prev => JSON.stringify(prev) === JSON.stringify(entry))
      );
  
      // Filter relevant offers based on size
      const relevantNewEntries = newEntries.filter(entry => TARGET_SIZES.includes(entry.size));
  
      // Send email only if there are relevant new entries
      if (relevantNewEntries.length > 0) {
        await sendEmailNotification(relevantNewEntries);
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