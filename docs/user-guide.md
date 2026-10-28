# User guide

This guide is for students using a QuickAssign site. If you run the site, share it with your users, or link to it from your help pages.

QuickAssign reads the class WhatsApp groups you choose, tells you when an assignment is posted, reminds you before deadlines, and, when you ask, sends a worked solution to your own WhatsApp chat. It never posts in your groups, never messages anyone but you, and never submits anything.

## Before you start

- You need an email address for your account, and WhatsApp on your phone.
- You must be 18 or older.
- **Use it at your own risk.** QuickAssign connects to WhatsApp as a linked device, like WhatsApp Web, through an unofficial connection.
  - A linked device can read **all** your chats and send messages as you. QuickAssign's code only reads the groups you switch on and only messages your own chat, but you are trusting whoever runs the site with your whole account.
  - Messages from the groups you switch on are processed by an AI service (OpenAI).
  - WhatsApp may restrict or ban accounts it believes use unofficial software.
  - You can unlink at any time. The full [disclaimer](../DISCLAIMER.md) explains every risk.
- **Know your university's rules.** Solutions are a learning aid. Many universities require you to disclose AI help, and every PDF includes a short reminder to do so. Quizzes and exams are never solved.

## 1. Create your account and profile

Choose **Create an account** and enter your name, your email address and a password of at least 10 characters. Use a password you don't use anywhere else. QuickAssign stores only a salted hash of it, never the password itself.

If you forget your password, ask the person who runs the site to reset it. The site doesn't send email.

Then fill in your profile: roll or registration number, university, department, program and semester. These details are printed on the header of your PDFs. You can change them later in **Settings**.

## 2. Link WhatsApp

Open **WhatsApp** in the menu. There are two ways to link:

- **With a code** (best on your phone): enter your WhatsApp number with the country code, for example `+92 300 1234567`. QuickAssign shows an 8-character code. In WhatsApp, go to **Settings → Linked devices → Link a device → Link with phone number instead**, and type the code.
- **With a QR code** (best on a laptop): in WhatsApp, go to **Settings → Linked devices → Link a device** and scan the code on screen.

The new device appears in WhatsApp as **QuickAssign**. Things to know:

- WhatsApp allows four linked devices. If all four are in use, remove one first.
- If your phone stays offline for about two weeks, WhatsApp logs out its linked devices. Open WhatsApp now and then, and link again if QuickAssign says it was logged out.
- Your phone behaves exactly as before: QuickAssign never marks messages as read and never shows you as online.

## 3. Choose your class groups

Open **Groups** and switch on the groups to watch. For each one:

- **Pick its course,** so solutions use the right material.
- **Tag who posts assignments,** such as the instructor, a TA or the class rep (CR). Tagged senders help QuickAssign tell real assignments from chatter.

Only the groups you switch on are read. Messages from every other chat are dropped on arrival and never stored. If you switch groups on soon after linking, QuickAssign also checks their last two weeks of messages for assignments that are still open.

## 4. Add courses and material

Open **Courses**, add each course, and upload its slides, notes or handouts: PDF, DOCX, PPTX or TXT, up to 20 MB per file. Solutions draw on this material and follow its notation, so the more you add, the better they fit your course.

## 5. When an assignment is posted

When QuickAssign spots an assignment in a watched group, a notice arrives in your **"Message yourself"** chat with the course, title and deadline. Reply to it:

- **solve** for a worked solution (1 credit), or
- **skip** to ignore it.

It also handles what usually follows an assignment:

- **Reminders** come 24 hours and 3 hours before the deadline.
- **Deadline changes** posted in the group, such as an extension, update the task and its reminders.
- **Quizzes and exams** get a reminder, never a solution.

If an assignment lives somewhere else, such as a portal link or "check Classroom", add it yourself (see [step 7](#7-add-a-task-yourself)).

## 6. WhatsApp commands

QuickAssign only reads messages in "Message yourself" that **reply to one of its messages** or **start with `qa`**. Your other notes there stay private.

| Command | What it does |
|---|---|
| Reply **solve** to a notice | Get a worked solution (1 credit). `yes`, `haan`, `ji`, `kar do` and `bana do` work too. |
| Reply **skip** to a notice | Ignore the task. `no`, `nahi`, `cancel` and `chor do` work too. |
| `qa solve 12` | Solve task #12 without replying to its notice. |
| `qa skip 12` | Skip task #12. |
| `qa status` | List your open tasks and their numbers. |
| `qa help` | Show the commands. |

## 7. Add a task yourself

Open **Tasks → New**. Give it a title, a course, a deadline and the assignment text, then upload any files: PDF, DOCX, PPTX, PNG, JPEG or TXT. On the task page, click **Get worked solution**. You can also add files to a detected task, for example when the group only said "uploaded on the portal".

## 8. Your solution

A worked solution arrives as a PDF in "Message yourself". The task page in your dashboard has the PDF and an editable DOCX. Each solution:

- works through each question, lists the concepts it used, and cites your course material where it relies on it;
- states its assumptions and notes the parts it's less sure about;
- ends with a reminder to disclose AI help if you use it in work you submit.

AI answers can be wrong. Check every solution before you rely on it. If you want another attempt, **Generate a new version** on the task page (1 credit).

## 9. Credits and plans

- New accounts get a few free trial credits. They never expire and have no cash value.
- One credit buys one worked solution. Detection, tracking, reminders and quiz or exam alerts are free.
- Plans under **Plans & credits** add credits that last for the plan's period (30 days by default). Credits that expire soonest are used first. Plans never renew by themselves.
- If a solution can't be produced, the credit comes back automatically.
- Each payment has an 8-character reference on the **Plans & credits** page. Quote it if you contact support.

## 10. Privacy and control

- **What's stored:** messages from groups you switched on, for 30 days; your QuickAssign commands, for 7 days; your tasks, solutions and course material, until you delete them. Message content, files and solutions are encrypted with a key that belongs to your account.
- **Classmates stay anonymous.** Phone numbers are never stored, and the AI sees classmates as `S1`, `S2` and so on, never by name or number.
- **Stop watching a group** by switching it off under **Groups**.
- **Unlink WhatsApp** from the WhatsApp page, or on your phone under **Linked devices**. Unlinking destroys the link's keys.
- **Change your password** or **sign out of all devices** from **Settings**. Changing your password signs out your other devices.
- **Delete your account** from **Settings**. You'll be asked for your password again first. Deleting unlinks WhatsApp, removes your data and destroys your encryption key. Payment and security records are kept as the law requires, linked only to a random ID.

The site's privacy policy (`/privacy`) has the full details.

## Problems?

| Problem | What to do |
|---|---|
| You forgot your password | Ask the person who runs the site to reset it. |
| "Too many attempts" when signing in | Wait 15 minutes, then try again. |
| No notice for an assignment | Check the group is switched on under **Groups** and tagged with the right course. If the message only pointed elsewhere, add the task yourself. |
| "Logged out" on the WhatsApp page | Your phone removed the device, or was offline too long. Link again. |
| "You're out of credits" | Buy a plan under **Plans & credits**, then reply **solve** again. |
| Linking says your account requires a passkey | Your WhatsApp account requires a passkey to link devices, which QuickAssign can't provide. |
| You paid but got no credits | Payments are re-checked every few minutes. If credits still haven't arrived after an hour, contact the site with your payment reference. |
