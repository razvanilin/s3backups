require("dotenv").config();

const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");

// Set constants
const BACKUP_DIR = process.env.BACKUP_DIR;
const BUCKET_NAME = process.env.BUCKET_NAME;
const BACKUP_FOLDER_IN_S3 = process.env.BACKUP_FOLDER_IN_S3;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

// Configure S3
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

// Function to get the latest file in the backup directory
function getLatestBackupFile() {
  const files = fs.readdirSync(BACKUP_DIR)
    .map(fileName => ({
      name: fileName,
      time: fs.statSync(path.join(BACKUP_DIR, fileName)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? files[0].name : null;
}

// Function to upload file to S3
async function uploadFileToS3(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const fileName = path.basename(filePath);

  const params = {
    Bucket: BUCKET_NAME,
    Key: `${BACKUP_FOLDER_IN_S3}${fileName}`,
    Body: fileStream,
  };

  try {
    const data = await s3.upload(params).promise();
    console.log(`File uploaded successfully at ${data.Location}`);
  } catch (err) {
    console.error("Error uploading file:", err);
  }
}

// Main function
async function backupToS3() {
  const latestFile = getLatestBackupFile();
  if (!latestFile) {
    console.log("No backup files found.");
    return;
  }

  const filePath = path.join(BACKUP_DIR, latestFile);
  console.log(`Uploading latest backup: ${latestFile}`);

  await uploadFileToS3(filePath);
}

// Run the backup process once a day (using cron or a similar scheduler)
backupToS3();
