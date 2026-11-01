# Evolution Go

Evolution Go is a high-performance WhatsApp API gateway built in Go, designed for scalable multi-instance WhatsApp integrations. It provides a comprehensive REST API with 79 endpoints for sending messages, managing groups, handling media, and receiving real-time events through multiple channels including webhooks, RabbitMQ, NATS, and WebSocket connections.

The platform leverages the whatsmeow library for native WhatsApp Multi-Device protocol support, enabling reliable connections without requiring the official WhatsApp Business API. Key features include multi-instance management for handling multiple WhatsApp accounts simultaneously, automatic media conversion and storage via MinIO/S3, flexible event distribution systems, and Docker-ready deployment configurations for production environments.

## Installation

Evolution Go can be installed using Docker (recommended) or locally with Go 1.24+.

```bash
# Clone the repository
git clone https://git.evoai.app/Evolution/evolution-go.git
cd evolution-go

# Generate a secure API key
uuidgen  # Example output: df16caad-d0d2-41b2-bec5-75b90048a0db

# Edit docker-compose.yml and set GLOBAL_API_KEY
nano docker-compose.yml

# Start services
docker-compose up -d

# Verify installation
curl http://localhost:4000/server/ok
# Expected: {"status": "ok"}

# Access Swagger documentation
# http://localhost:4000/swagger/index.html
```

## Authentication

All API requests require the `apikey` header. There are two types of API keys: the Global API Key for administrative operations and Instance Tokens for instance-specific operations.

```bash
# Administrative operations use GLOBAL_API_KEY (from environment variable)
curl -X POST http://localhost:4000/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR-GLOBAL-API-KEY" \
  -d '{"name": "sales", "token": "instance-token-123"}'

# Instance operations use the token defined when creating the instance
curl -X POST http://localhost:4000/send/text \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"number": "5511999999999", "text": "Hello!"}'
```

## Instance Management API

### Create Instance

Creates a new WhatsApp instance with a unique name and authentication token.

```bash
curl -X POST http://localhost:4000/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR-GLOBAL-API-KEY" \
  -d '{
    "name": "sales-bot",
    "token": "secure-unique-token-123",
    "webhook": "https://your-server.com/webhook",
    "webhookEvents": ["messages.upsert", "connection.update"]
  }'

# Response:
# {
#   "message": "success",
#   "data": {
#     "name": "sales-bot",
#     "token": "secure-unique-token-123",
#     "status": "created",
#     "createdAt": "2025-01-15T10:30:00Z"
#   }
# }
```

### Connect Instance

Initiates the QR code connection process for an instance.

```bash
curl -X POST http://localhost:4000/instance/connect \
  -H "Content-Type: application/json" \
  -H "apikey: secure-unique-token-123" \
  -d '{
    "webhookUrl": "https://your-server.com/webhook",
    "subscribe": ["MESSAGE", "GROUP", "CALL"]
  }'

# Response:
# {
#   "message": "success",
#   "data": {
#     "jid": "5511999999999@s.whatsapp.net",
#     "webhookUrl": "https://your-server.com/webhook"
#   }
# }
```

### Get QR Code

Retrieves the QR code for WhatsApp authentication.

```bash
curl http://localhost:4000/instance/qr \
  -H "apikey: secure-unique-token-123"

# Response:
# {
#   "message": "success",
#   "data": {
#     "qrcode": "2@abcd1234...",
#     "code": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
#   }
# }
```

### Pair with Code

Connects using an 8-digit pairing code instead of QR code.

```bash
curl -X POST http://localhost:4000/instance/pair \
  -H "Content-Type: application/json" \
  -H "apikey: secure-unique-token-123" \
  -d '{"phone": "5511999999999"}'

# Response:
# {
#   "message": "success",
#   "data": {"code": "12345678"}
# }
# Enter this code in WhatsApp > Linked Devices > Link with phone number
```

### Check Connection Status

Verifies the current connection status of an instance.

```bash
curl http://localhost:4000/instance/status \
  -H "apikey: secure-unique-token-123"

# Response:
# {
#   "message": "success",
#   "data": {
#     "connected": true,
#     "loggedIn": true,
#     "name": "My Business",
#     "myJid": "5511999999999@s.whatsapp.net"
#   }
# }
```

### List All Instances

Returns all registered instances (administrative endpoint).

```bash
curl http://localhost:4000/instance/all \
  -H "apikey: YOUR-GLOBAL-API-KEY"

# Response:
# {
#   "message": "success",
#   "data": [
#     {"id": "abc123", "name": "sales", "connected": true, "jid": "5511999999999@s.whatsapp.net"},
#     {"id": "def456", "name": "support", "connected": false, "jid": null}
#   ]
# }
```

### Delete Instance

Permanently removes an instance and all its data.

```bash
curl -X DELETE http://localhost:4000/instance/delete/sales-bot \
  -H "apikey: YOUR-GLOBAL-API-KEY"

# Response: {"message": "success"}
```

## Messaging API

### Send Text Message

Sends a simple text message to a WhatsApp number or group.

```bash
curl -X POST http://localhost:4000/send/text \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "text": "Hello! How can I help you today?",
    "delay": 1000
  }'

# Response:
# {
#   "message": "success",
#   "data": {
#     "Info": {
#       "ID": "3EB0C5A277F7F9B6C599",
#       "Timestamp": "2025-01-15T10:30:00Z",
#       "Type": "ExtendedTextMessage"
#     }
#   }
# }
```

### Send Media (Image/Video/Audio/Document)

Sends media files via URL or file upload.

```bash
# Send image via URL
curl -X POST http://localhost:4000/send/media \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "url": "https://example.com/product.jpg",
    "type": "image",
    "caption": "Check out our new product!"
  }'

# Send document via file upload
curl -X POST http://localhost:4000/send/media \
  -H "apikey: instance-token-123" \
  -F "number=5511999999999" \
  -F "type=document" \
  -F "filename=report.pdf" \
  -F "file=@/path/to/report.pdf"

# Response:
# {
#   "message": "success",
#   "data": {"Info": {"ID": "3EB0C5A277F7F9B6C599", "Type": "ImageMessage"}}
# }
```

### Send Link with Preview

Sends a message with automatic link preview extraction.

```bash
curl -X POST http://localhost:4000/send/link \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "text": "Check this article: https://example.com/article",
    "title": "Article Title",
    "description": "Article description",
    "imgUrl": "https://example.com/image.jpg"
  }'
```

### Send Poll

Creates an interactive poll with multiple options.

```bash
curl -X POST http://localhost:4000/send/poll \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "question": "What is your preferred time slot?",
    "maxAnswer": 1,
    "options": ["Morning (8am-12pm)", "Afternoon (1pm-6pm)", "Evening (7pm-10pm)"]
  }'

# Response:
# {
#   "message": "success",
#   "data": {"Info": {"ID": "3EB0C5A277F7F9B6C599", "Type": "PollCreationMessage"}}
# }
```

### Send Sticker

Sends a sticker (automatically converts images to WebP format).

```bash
curl -X POST http://localhost:4000/send/sticker \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "sticker": "https://example.com/sticker.png"
  }'
```

### Send Location

Sends a geographic location with name and address.

```bash
curl -X POST http://localhost:4000/send/location \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "name": "Central Office",
    "address": "123 Main Street, New York, NY",
    "latitude": 40.7128,
    "longitude": -74.0060
  }'
```

### Send Contact (VCard)

Sends a contact card with phone number and optional organization.

```bash
curl -X POST http://localhost:4000/send/contact \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "vcard": {
      "fullName": "John Smith",
      "phone": "5511888888888",
      "organization": "Acme Corp"
    }
  }'
```

### React to Message

Adds or removes an emoji reaction from a message.

```bash
# Add reaction
curl -X POST http://localhost:4000/message/react \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "reaction": "👍",
    "id": "3EB0C5A277F7F9B6C599",
    "fromMe": false
  }'

# Remove reaction
curl -X POST http://localhost:4000/message/react \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "reaction": "remove",
    "id": "3EB0C5A277F7F9B6C599",
    "fromMe": false
  }'
```

### Mark Message as Read

Marks one or more messages as read.

```bash
curl -X POST http://localhost:4000/message/markread \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "id": ["3EB0C5A277F7F9B6C599", "3EB0C5A277F7F9B6C600"]
  }'
```

### Edit Message

Edits a previously sent text message.

```bash
curl -X POST http://localhost:4000/message/edit \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "chat": "5511999999999@s.whatsapp.net",
    "messageId": "3EB0C5A277F7F9B6C599",
    "message": "Corrected message text"
  }'
```

### Delete Message

Deletes a message for everyone (revoke).

```bash
curl -X POST http://localhost:4000/message/delete \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "chat": "5511999999999@s.whatsapp.net",
    "messageId": "3EB0C5A277F7F9B6C599"
  }'
```

### Set Chat Presence

Shows typing indicator or recording audio status.

```bash
# Show "typing..."
curl -X POST http://localhost:4000/message/presence \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "state": "composing",
    "isAudio": false
  }'

# Show "recording audio..."
curl -X POST http://localhost:4000/message/presence \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "state": "composing",
    "isAudio": true
  }'

# Stop typing indicator
curl -X POST http://localhost:4000/message/presence \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "state": "paused"
  }'
```

## Group Management API

### Create Group

Creates a new WhatsApp group with specified participants.

```bash
curl -X POST http://localhost:4000/group/create \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupName": "Sales Team",
    "participants": ["5511999999999", "5511888888888"]
  }'

# Response:
# {
#   "message": "success",
#   "data": {
#     "jid": "120363XXXXXXXXXX@g.us",
#     "name": "Sales Team",
#     "owner": "5511999999999@s.whatsapp.net",
#     "added": ["5511999999999@s.whatsapp.net", "5511888888888@s.whatsapp.net"],
#     "failed": []
#   }
# }
```

### List Groups

Returns all groups the account participates in.

```bash
curl http://localhost:4000/group/list \
  -H "apikey: instance-token-123"

# Response:
# {
#   "message": "success",
#   "data": [
#     {
#       "JID": "120363XXXXXXXXXX@g.us",
#       "GroupName": {"Name": "Sales Team"},
#       "Participants": [
#         {"JID": "5511999999999@s.whatsapp.net", "IsAdmin": true},
#         {"JID": "5511888888888@s.whatsapp.net", "IsAdmin": false}
#       ]
#     }
#   ]
# }
```

### Get Group Info

Retrieves detailed information about a specific group.

```bash
curl -X POST http://localhost:4000/group/info \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"groupJid": "120363XXXXXXXXXX@g.us"}'
```

### Manage Participants

Adds, removes, promotes, or demotes group participants.

```bash
# Add participants
curl -X POST http://localhost:4000/group/participant \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "action": "add",
    "participants": ["5511777777777"]
  }'

# Remove participants
curl -X POST http://localhost:4000/group/participant \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "action": "remove",
    "participants": ["5511777777777"]
  }'

# Promote to admin
curl -X POST http://localhost:4000/group/participant \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "action": "promote",
    "participants": ["5511888888888"]
  }'

# Demote from admin
curl -X POST http://localhost:4000/group/participant \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "action": "demote",
    "participants": ["5511888888888"]
  }'
```

### Get Invite Link

Generates or retrieves the group invite link.

```bash
curl -X POST http://localhost:4000/group/invitelink \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "reset": false
  }'

# Response:
# {
#   "message": "success",
#   "data": "https://chat.whatsapp.com/ABCDEFGHIJKLMNOP"
# }
```

### Update Group Settings

Updates group name, description, or photo.

```bash
# Update group name
curl -X POST http://localhost:4000/group/name \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "name": "New Group Name"
  }'

# Update group description
curl -X POST http://localhost:4000/group/description \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "description": "New group description text"
  }'

# Update group photo
curl -X POST http://localhost:4000/group/photo \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupJid": "120363XXXXXXXXXX@g.us",
    "image": "https://example.com/group-photo.jpg"
  }'
```

### Join/Leave Group

Joins a group via invite link or leaves a group.

```bash
# Join group via invite link
curl -X POST http://localhost:4000/group/join \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"code": "https://chat.whatsapp.com/ABCDEFGHIJKLMNOP"}'

# Leave group
curl -X POST http://localhost:4000/group/leave \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"groupJid": "120363XXXXXXXXXX@g.us"}'
```

## User Management API

### Check WhatsApp Number

Verifies if phone numbers are registered on WhatsApp.

```bash
curl -X POST http://localhost:4000/user/check \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": ["5511999999999", "5511888888888"]
  }'

# Response:
# {
#   "message": "success",
#   "data": {
#     "Users": [
#       {"Query": "5511999999999", "IsInWhatsapp": true, "JID": "5511999999999@s.whatsapp.net"},
#       {"Query": "5511888888888", "IsInWhatsapp": false, "JID": ""}
#     ]
#   }
# }
```

### Get User Info

Retrieves detailed information about WhatsApp users.

```bash
curl -X POST http://localhost:4000/user/info \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"number": ["5511999999999"]}'

# Response includes status, verified name, profile picture ID, and devices
```

### Get User Avatar

Retrieves the profile picture URL of a user.

```bash
curl -X POST http://localhost:4000/user/avatar \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "number": "5511999999999",
    "preview": false
  }'

# Response:
# {
#   "message": "success",
#   "data": {
#     "URL": "https://pps.whatsapp.net/v/...",
#     "ID": "abc123"
#   }
# }
```

### Manage Profile

Updates your WhatsApp profile picture, name, and status.

```bash
# Update profile picture
curl -X POST http://localhost:4000/user/profilePicture \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"image": "https://example.com/my-photo.jpg"}'

# Update profile name
curl -X POST http://localhost:4000/user/profileName \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"name": "My Business Name"}'

# Update profile status
curl -X POST http://localhost:4000/user/profileStatus \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"status": "Available 24/7 for support!"}'
```

### Block/Unblock Contacts

Manages the contact block list.

```bash
# Block contact
curl -X POST http://localhost:4000/user/block \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"number": "5511999999999"}'

# Unblock contact
curl -X POST http://localhost:4000/user/unblock \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"number": "5511999999999"}'

# List blocked contacts
curl http://localhost:4000/user/blocklist \
  -H "apikey: instance-token-123"
```

### Privacy Settings

Configures account privacy settings.

```bash
# Get current privacy settings
curl http://localhost:4000/user/privacy \
  -H "apikey: instance-token-123"

# Update privacy settings
curl -X POST http://localhost:4000/user/privacy \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{
    "groupAdd": "contacts",
    "lastSeen": "contacts",
    "status": "contacts",
    "profile": "all",
    "readReceipts": "all",
    "callAdd": "contacts",
    "online": "all"
  }'
# Values: "all", "contacts", "contact_blacklist", "none"
```

## Chat Management API

### Pin/Unpin Chat

Pins or unpins a conversation to the top of the chat list.

```bash
# Pin chat
curl -X POST http://localhost:4000/chat/pin \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"chat": "5511999999999@s.whatsapp.net"}'

# Unpin chat
curl -X POST http://localhost:4000/chat/unpin \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"chat": "5511999999999@s.whatsapp.net"}'
```

### Archive/Unarchive Chat

Moves conversations to/from the archive.

```bash
# Archive chat
curl -X POST http://localhost:4000/chat/archive \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"chat": "5511999999999@s.whatsapp.net"}'

# Unarchive chat
curl -X POST http://localhost:4000/chat/unarchive \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"chat": "5511999999999@s.whatsapp.net"}'
```

### Mute/Unmute Chat

Silences notifications for a chat (1 hour duration).

```bash
# Mute chat
curl -X POST http://localhost:4000/chat/mute \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"chat": "120363XXXXXXXXXX@g.us"}'

# Unmute chat
curl -X POST http://localhost:4000/chat/unmute \
  -H "Content-Type: application/json" \
  -H "apikey: instance-token-123" \
  -d '{"chat": "120363XXXXXXXXXX@g.us"}'
```

## Event System

Evolution Go supports multiple event distribution channels for real-time notifications.

### Webhook Configuration

Configure webhooks via environment variables or per-instance during connection.

```bash
# Environment variable (global webhook)
WEBHOOK_URL=https://your-server.com/webhook

# Per-instance webhook during connect
curl -X POST http://localhost:4000/instance/connect \
  -H "apikey: instance-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://your-server.com/webhook-sales",
    "subscribe": ["MESSAGE", "GROUP", "CALL"]
  }'
```

### Webhook Payload Example

```json
{
  "event": "MESSAGE",
  "instance": "sales-bot",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "3EB0C5A277F7F9B6C599"
    },
    "message": {
      "conversation": "Hello! I need help with my order."
    },
    "messageTimestamp": "1699999999",
    "pushName": "John Smith"
  }
}
```

### Webhook Server Example (Node.js)

```javascript
const express = require('express');
const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  const { event, instance, data } = req.body;
  console.log(`Event: ${event} from instance: ${instance}`);

  if (event === 'MESSAGE') {
    const message = data.message.conversation;
    const from = data.key.remoteJid;
    console.log(`Message from ${from}: ${message}`);
  }

  res.status(200).json({ received: true });
});

app.listen(3000, () => console.log('Webhook server running on port 3000'));
```

### WebSocket Connection

Connect via WebSocket for real-time event streaming.

```javascript
// Connect to specific instance
const ws = new WebSocket('ws://localhost:4000/ws?token=instance-token-123&instanceId=sales');

// Or connect to all instances (broadcast mode)
const wsBroadcast = new WebSocket('ws://localhost:4000/ws?token=GLOBAL_API_KEY');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  const payload = JSON.parse(data.payload);
  console.log(`Event: ${data.queue}`, payload);
};
```

### RabbitMQ Configuration

Configure RabbitMQ for reliable message queuing.

```bash
# Environment variables
AMQP_URL=amqp://user:password@localhost:5672/
AMQP_GLOBAL_ENABLED=true
AMQP_SPECIFIC_EVENTS=message,sendmessage,receipt,presence

# Consumer example (Python)
import pika
import json

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

def callback(ch, method, properties, body):
    data = json.loads(body)
    print(f"Event: {data}")

channel.basic_consume(queue='message', on_message_callback=callback, auto_ack=True)
channel.start_consuming()
```

### NATS Configuration

Configure NATS for high-performance pub/sub messaging.

```bash
# Environment variables
NATS_URL=nats://localhost:4222
NATS_ENABLED=true

# Topics follow pattern: evolution.{instance}.{event_type}
# Example: evolution.sales.message
```

## Summary

Evolution Go provides a comprehensive solution for building WhatsApp integrations at scale. The primary use cases include customer service automation, marketing campaigns, notification systems, and multi-agent chat platforms. The API supports all major WhatsApp features including text and media messaging, group management, contact operations, and real-time event handling through multiple channels.

Integration patterns typically involve creating instances for different business units or use cases, connecting them via QR code or pairing code, configuring webhooks or message queues for event handling, and using the REST API to send messages and manage conversations. For production deployments, Docker Compose or Docker Swarm configurations are provided with PostgreSQL for data persistence, optional RabbitMQ/NATS for event distribution, and MinIO for media storage. The platform's multi-instance architecture allows scaling from single-account use cases to enterprise deployments managing hundreds of WhatsApp connections simultaneously.