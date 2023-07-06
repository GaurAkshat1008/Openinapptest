import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import process from "process";
import path from "path";
import { promises } from "fs";
import { scheduleJob } from "node-schedule";

const main = async () => {
  const SCOPES = [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
  ];

  const TOKEN_PATH = path.join(process.cwd(), "token.json");
  const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

  /**
   * Reads previously authorized credentials from the save file.
   *
   * @return {Promise<OAuth2Client|null>}
   */
  async function loadSavedCredentialsIfExist() {
    try {
      const content = await promises.readFile(TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  /**
   * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
   *
   * @param {OAuth2Client} client
   * @return {Promise<void>}
   */
  async function saveCredentials(client) {
    const content = await promises.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await promises.writeFile(TOKEN_PATH, payload);
  }

  /**
   * Load or request or authorization to call APIs.
   *
   */
  async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
      await saveCredentials(client);
    }
    return client;
  }

  /**
   * Lists the labels in the user's account.
   *
   * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
   */
  async function listLabels(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.labels.list({
      userId: "me",
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
      console.log("No labels found.");
      return;
    }
    console.log("Labels:");
    labels.forEach((label) => {
      console.log(`- ${label.id}`);
    });
  }

  async function replyTemplate(auth, threadId) {
    const gmail = google.gmail({ version: "v1", auth });
    const message = "Sorry, I'm busy now. So I can't reply to you.";
    const header = await gmail.users.messages.get({
      userId: "me",
      id: threadId,
    });
    const from = header.data.payload.headers.find(
      (header) => header.name === "From"
    ).value;
    const to = header.data.payload.headers.find(
      (header) => header.name === "To"
    ).value;
    console.log(from, to);
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        threadId: threadId,
        raw: createMessageRaw(to, from, message),
      },
    });
    const res2 = await gmail.users.messages.modify({
      userId: "me",
      id: threadId,
      requestBody: {
        addLabelIds: ["Label_8502055040975068566"],
        removeLabelIds: ["UNREAD"],
        markasread: true,
      },
    });
  }

  const createMessageRaw = (to, from, message) => {
    var str = [
      'Content-Type: text/plain; charset="UTF-8"\n',
      "MIME-Version: 1.0\n",
      "Content-Transfer-Encoding: 7bit\n",
      "to: ",
      to,
      "\n",
      "from: ",
      from,
      "\n",
      message,
    ].join("");

    var encodedMail = Buffer(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    return encodedMail;
  };

  async function sendEmailToUnReplied(auth, threadId) {
    await replyTemplate(auth, threadId);
  }

  async function getMessagesFromThreads(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.threads.list({
      userId: "me",
      q: "in:inbox is:unread label:UNREAD",
    });
    const threads = res.data.threads;
    if (!threads || threads.length === 0) {
      console.log("No threads found.");
      return;
    }
    console.log(threads.length);
    console.log("Threads:");
    threads.forEach((thread) => {
      console.log(`- ${thread.id}`);
      sendEmailToUnReplied(auth, thread.id);
    });
  }

  authorize().then((auth) => {
    const random = Math.floor(Math.random() * 120) + 44;
    scheduleJob(`*/${random} * * * * *`, () => {
      console.log("Running getMessagesFromThreads");
      getMessagesFromThreads(auth);
    });
  });
};

main().catch(console.error);
