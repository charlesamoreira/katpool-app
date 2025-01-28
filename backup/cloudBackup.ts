import { exec } from "child_process";
import { google } from "googleapis";
import cron from 'node-cron'; // Import node-cron
import config from "../config/config.json";
import googleCredentials from "./google-credentials.json";
import path from "path";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const backupScriptPath = path.resolve(__dirname, "backup.sh");
const payoutsPerDay = config.payoutsPerDay || 2; // Default to twice a day if not set
const paymentInterval = 24 / payoutsPerDay;
if (paymentInterval < 1 || paymentInterval > 24) {
  throw new Error('paymentInterval must be between 1 and 24 hours.');
}

const backupEmailAddress = config.backupEmailAddress || "socials@onargon.com";

// Google Drive API authorization
async function authorize() {
    const formattedPrivateKey = googleCredentials.private_key.replace(/\\n/g, "\n");
    const jwtClient = new google.auth.JWT(
        googleCredentials.client_email,
        undefined,
        formattedPrivateKey,
        SCOPES
    );
    await jwtClient.authorize();
    return jwtClient;
}

// Upload file to Google Drive
async function uploadFile(authClient: any, fileName: string) {
    const drive = google.drive({ version: "v3", auth: authClient });
    try {
        const file = await drive.files.create({
            media: { body: require("fs").createReadStream(fileName) },
            fields: "id",
            requestBody: { name: fileName.split("/").pop() },
        });
        console.log("File Uploaded:", file.data.id);

        await drive.permissions.create({
            fileId: file.data.id!,
            requestBody: {
                type: "user",
                role: "writer",
                emailAddress: backupEmailAddress,
            },
        });
        console.log(`Permission granted to: ${backupEmailAddress}`);
    } catch (err) {
        console.error(`Error uploading file ${fileName}:`, err.message);
    }
}

// Run backup and upload process
async function runBackupAndUpload() {
    console.log(`[${new Date().toISOString()}] Starting backup...`);

    exec(`bash ${backupScriptPath}`, async (error, stdout, stderr) => {
        if (error) {
            console.error(`Backup script error: ${stderr}`);
            return;
        }

        const output = stdout.trim();
        console.log("Backup script output:", output);

        // Extract the backup filename from the output
        const match = output.match(/Backup completed: (.+\.gz)/);
        if (match && match[1]) {
            const backupFile = match[1];
            console.log(`Backup file identified: ${backupFile}`);

            const authClient = await authorize();
            await uploadFile(authClient, backupFile);
        } else {
            console.error("Backup file not identified in the script output.");
        }
    });
}

// Schedule the job based on the interval
cron.schedule(`0 */${paymentInterval} * * *`, async () => {
    console.log(`Scheduled backup and upload started at ${new Date().toISOString()}`);

    // We are waiting for a delay after the payment cycle, before pushing the DB dump to Google drive.
    const delay = (10 * 60 * 1000); // Convert to milliseconds

    // Wait for the delay before executing the backup and upload
    setTimeout(async () => {
        console.log(`Running backup and upload after delay at ${new Date().toISOString()}`);
        await runBackupAndUpload();
    }, delay);
});