# Disclaimer: use QuickAssign at your own risk

> [!CAUTION]
> **Linking a WhatsApp account to QuickAssign gives the software, and whoever runs its server, full access to that account. Messages are also processed by an AI service. You use QuickAssign entirely at your own risk.** If you don't accept the risks on this page, don't use it, and don't link a WhatsApp account.

QuickAssign is experimental, open-source software. The [MIT License](LICENSE) provides it "as is", without warranty of any kind. This page spells out what that means in practice.

## 1. Your whole WhatsApp account is exposed

QuickAssign connects as a **linked device** on your WhatsApp account, the same mechanism WhatsApp Web uses.

- **The keys allow everything.** A linked device receives the messages of **all** your chats, not only the groups you pick, and can **send messages as you**. The keys that make this possible are stored on the QuickAssign server.
- **The code limits itself; the keys don't.** QuickAssign's code drops messages from groups you didn't switch on, and it can only send to your own "Message yourself" chat. But nothing in WhatsApp enforces those limits.
- **Who could misuse the keys:**
  - the person or company running the server;
  - anyone who modifies the code;
  - a bug;
  - an attacker who breaks into the server.

  Any of them could read every chat or send messages as you.
- **Encryption isn't protection from the operator.** QuickAssign encrypts stored messages and keys, but whoever runs the server holds the encryption keys too. Encryption protects against a stolen copy of the database, not against the server's operator.
- **Only use a site you trust.** On a QuickAssign site run by someone else, you are trusting them with your entire WhatsApp account.
- **You can cut access at any time.** On your phone, open WhatsApp → **Linked devices** and remove "QuickAssign".

## 2. AI reads your messages and files

To find assignments and write solutions, QuickAssign sends data to an AI service (OpenAI):

- messages from the groups you switch on, including your classmates' and teachers' messages;
- the files posted in those groups;
- assignment text you add, and the course material you upload.

Senders are replaced by codes like "S1" before messages reach the AI, but message text can still contain names, numbers or other personal details. QuickAssign asks OpenAI not to store responses, but OpenAI's own terms and data policies apply, and it may keep data for a limited time to detect abuse.

**AI output can be wrong, incomplete or misleading.** Check every detected deadline and every solution yourself.

## 3. WhatsApp may restrict or ban your account

QuickAssign is **not** an official WhatsApp integration. It uses an unofficial library, [whatsmeow](https://github.com/tulir/whatsmeow), and WhatsApp's terms don't allow unofficial clients.

- WhatsApp may restrict or **permanently ban** any account that uses it, at any time, without warning.
- WhatsApp can change its protocol and break QuickAssign at any time.
- Consider using a spare number.

QuickAssign is not affiliated with, endorsed by or sponsored by WhatsApp, Meta, OpenAI or Safepay.

## 4. Other people's messages

The groups you switch on contain messages from classmates and teachers who never agreed to have them processed by QuickAssign or by an AI service. Data-protection laws, such as the GDPR in Europe, may apply to you. Make sure you're allowed to process those messages before you switch a group on.

## 5. Academic integrity

Worked solutions are meant as a learning aid. Many universities restrict or forbid AI help, or require you to disclose it. Some countries make it an offence to provide assignment-writing services commercially. You alone are responsible for how you use the solutions, and for any academic or legal consequences.

## 6. If you run QuickAssign for other people

As the operator, you hold every student's WhatsApp keys and data, and you are responsible for:

- the security of your server, its encryption keys and its backups;
- telling your users about these risks;
- complying with the law where you and your users are, including data protection, consumer and payment rules.

The built-in privacy policy, terms and refund policy are templates written for an operator in Pakistan. They are not legal advice. Have a lawyer adapt them before you launch.

## 7. No liability

To the fullest extent the law allows, the authors and contributors of QuickAssign accept **no liability** for any harm from using it, including:
- banned or restricted WhatsApp accounts;
- leaked, lost or misused messages and data;
- messages sent from your account;
- wrong AI answers, missed deadlines and academic penalties;
- financial loss.

By linking a WhatsApp account, or by running QuickAssign for anyone, you accept these risks.
