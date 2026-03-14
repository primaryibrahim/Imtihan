const https = require('https');
const fs = require('fs');

const data = JSON.stringify({
    html: '<!DOCTYPE html><html><body><h1>Test PDF</h1><p>Passed verification.</p></body></html>'
});

const options = {
    hostname: 'us-central1-imtihanati-e8ffa.cloudfunctions.net',
    port: 443,
    path: '/generatePdf',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

console.log('Testing PDF generation...');

const req = https.request(options, res => {
    console.log(`Status Code: ${res.statusCode}`);

    if (res.statusCode === 200) {
        const file = fs.createWriteStream("test_output.pdf");
        res.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log('PDF downloaded successfully to test_output.pdf');
        });
    } else {
        res.on('data', d => {
            process.stdout.write(d);
        });
    }
});

req.on('error', error => {
    console.error('Error:', error);
});

req.write(data);
req.end();
