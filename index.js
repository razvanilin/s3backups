require("dotenv").config();

const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");

// Set constants
const LOCAL_BACKUP_DIR = process.env.LOCAL_BACKUP_DIR;
const BUCKET_NAME = process.env.BUCKET_NAME;
const BACKUP_FOLDER_IN_S3 = process.env.BACKUP_FOLDER_IN_S3;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

// File patterns to look for in the backup directory
// useful if you have multiple databases and want to backup them separately
if (!process.env.DATABASE_PATTERN_LIST) {
  throw new Error("DATABASE_PATTERN_LIST is not set");
}

const FILE_PATTERNS = process.env.DATABASE_PATTERN_LIST.split(",");

// Configure S3
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

// Function to get the latest file matching each pattern in the backup directory
function getLatestFilesByPattern(patterns) {
  const latestFiles = [];

  patterns.forEach(pattern => {
    // Convert glob-like pattern to regex
    const regex = new RegExp(`^${pattern.replace("*", ".*")}$`);

    // Get files that match the pattern
    const files = fs.readdirSync(LOCAL_BACKUP_DIR)
      .filter(fileName => regex.test(fileName))
      .map(fileName => ({
        name: fileName,
        time: fs.statSync(path.join(LOCAL_BACKUP_DIR, fileName)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    // If there's a match, get the latest file for this pattern
    if (files.length > 0) {
      latestFiles.push(files[0].name);
    }
  });

  return latestFiles;
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

// Function to delete old backups from S3
async function deleteOldBackups() {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - parseInt(process.env.DELETE_OLDER_THAN_DAYS, 10));

  try {
    const params = {
      Bucket: BUCKET_NAME,
      Prefix: BACKUP_FOLDER_IN_S3
    };

    const { Contents } = await s3.listObjects(params).promise();
    
    if (!Contents || Contents.length === 0) return;

    const deletePromises = Contents
      .filter(item => item.LastModified < twoWeeksAgo)
      .map(item => {
        const deleteParams = {
          Bucket: BUCKET_NAME,
          Key: item.Key
        };
        return s3.deleteObject(deleteParams).promise();
      });

    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
      console.log(`Deleted ${deletePromises.length} old backup(s)`);
    }
  } catch (err) {
    console.error("Error deleting old backups:", err);
  }
}

// Main function
async function backupToS3() {
  if (process.env.DELETE_OLDER_THAN_DAYS) {
    // Delete old backups in the background
    try {
      deleteOldBackups();
    } catch (err) {
      console.error("Error deleting old backups:", err);
    }
  }

  const latestFiles = getLatestFilesByPattern(FILE_PATTERNS);
  if (!latestFiles.length) {
    console.log("No backup files found.");
    return;
  }

  for (const fileName of latestFiles) {
    const filePath = path.join(LOCAL_BACKUP_DIR, fileName);
    console.log(`Uploading latest backup: ${fileName}`);
    await uploadFileToS3(filePath);
  }
}

// Run the backup process once a day (using cron or a similar scheduler)
backupToS3();
