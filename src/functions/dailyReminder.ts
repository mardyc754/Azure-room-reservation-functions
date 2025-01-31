import { app, InvocationContext, Timer } from "@azure/functions";
import { createTransport } from "nodemailer";
import * as pg from "pg";

type Reservation = {
  id: number;
  roomId: number;
  userId: number;
  startDate: Date;
  endDate: Date;
  user: {
    id: number;
    name: string;
    email: string;
  };
};

type MessageData = {
  to: string;
  subject: string;
  message: string;
};

function formatDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

async function sendEmail(messageData: MessageData, context: InvocationContext) {
  try {
    context.log("Starting send email notification function");

    // Parse request body for email details
    const { to, subject, message } = messageData;

    if (!to || !subject || !message) {
      context.error("Missing required fields: to, subject, or message.");
      return;
    }

    // Configure Nodemailer transport
    const transporter = createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // if true the port is 465
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Email options
    const mailOptions = {
      from: `Room Reservation System <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: message,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    context.log("Email sent: ", info.response);
    context.log("Email sent successfully!");
    transporter.close();
  } catch (error) {
    context.error("Error sending email: ", error);
  }
}

export async function dailyReminder(
  myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  context.log("Timer function processed request.");

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const result = await pool.query(
    "SELECT * FROM reservations JOIN users ON reservations.user_id = users.id WHERE Date(start_date) = $1",
    [new Intl.DateTimeFormat("en-CA").format(new Date())]
  );

  context.log("Number of reservations: ", result.rows.length);

  const reservations = result.rows.map<Reservation>((row) => {
    return {
      id: row.id,
      roomId: row.room_id,
      userId: row.user_id,
      startDate: row.start_date,
      endDate: row.end_date,
      user: {
        id: row.user_id,
        name: row.username,
        email: row.email,
      },
    };
  });

  for (const reservation of reservations) {
    const message = {
      to: reservation.user.email,
      subject: "Daily Reminder",
      message: `Hello ${reservation.user.name}, your reservation in room ${
        reservation.roomId
      } is scheduled to start at ${formatDate(
        reservation.startDate
      )} and end at ${formatDate(reservation.endDate)}.`,
    };

    await sendEmail(message, context);
  }

  context.log("Number of emails sent: ", reservations.length);
}

app.timer("dailyReminder", {
  schedule: "0 0 9 * * *",
  handler: dailyReminder,
});
