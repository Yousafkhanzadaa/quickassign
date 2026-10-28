package session

import (
	"strings"
	"unicode/utf8"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

// Normalized is the minimal, provider-neutral view of a group message that we keep.
// Anything not listed here (stickers, reactions, polls, locations, thumbnails, contact cards)
// is dropped at the edge and never stored.
type Normalized struct {
	Kind      string // text | image | document | video | audio | other
	Text      string // message text or media caption
	QuotedID  string // stanza ID of the quoted message, if this is a reply
	MediaMime string
	MediaSize int64
	FileName  string
	// MediaDesc is a serialized waE2E.Message holding only the media sub-message
	// (keys + direct path, thumbnail stripped), used to download the file later on demand.
	MediaDesc []byte

	EditOf   string // when non-empty, this is an edit of the given message ID
	RevokeOf string // when non-empty, the given message ID was deleted for everyone
	Skip     bool   // nothing worth keeping
}

const maxTextRunes = 8000

// downloadable media we may fetch later; video/audio are not downloaded in this version.
var downloadableMime = map[string]bool{
	"application/pdf": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"application/msword":            true,
	"application/vnd.ms-powerpoint": true,
	"text/plain":                    true,
	"image/jpeg":                    true,
	"image/png":                     true,
	"image/webp":                    true,
}

// Normalize converts an unwrapped WhatsApp message into what we store.
func Normalize(msg *waE2E.Message, isViewOnce bool) Normalized {
	if msg == nil {
		return Normalized{Skip: true}
	}

	if pm := msg.GetProtocolMessage(); pm != nil {
		switch pm.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			if id := pm.GetKey().GetID(); id != "" {
				return Normalized{RevokeOf: id}
			}
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			id := pm.GetKey().GetID()
			if id == "" || pm.GetEditedMessage() == nil {
				return Normalized{Skip: true}
			}
			n := Normalize(pm.GetEditedMessage(), false)
			if n.Skip || n.RevokeOf != "" {
				return Normalized{Skip: true}
			}
			// Edits only change text/captions; never re-ingest media through an edit.
			return Normalized{Kind: n.Kind, Text: n.Text, QuotedID: n.QuotedID, EditOf: id}
		}
		return Normalized{Skip: true}
	}

	switch {
	case msg.GetConversation() != "":
		return Normalized{Kind: "text", Text: clip(msg.GetConversation())}

	case msg.GetExtendedTextMessage() != nil:
		et := msg.GetExtendedTextMessage()
		if strings.TrimSpace(et.GetText()) == "" {
			return Normalized{Skip: true}
		}
		return Normalized{Kind: "text", Text: clip(et.GetText()), QuotedID: et.GetContextInfo().GetStanzaID()}

	case msg.GetDocumentMessage() != nil:
		doc := msg.GetDocumentMessage()
		n := Normalized{
			Kind:      "document",
			Text:      clip(doc.GetCaption()),
			QuotedID:  doc.GetContextInfo().GetStanzaID(),
			MediaMime: baseMime(doc.GetMimetype()),
			MediaSize: int64(doc.GetFileLength()),
			FileName:  cleanFileName(firstNonEmpty(doc.GetFileName(), doc.GetTitle())),
		}
		if !isViewOnce && downloadableMime[n.MediaMime] {
			stripped := proto.Clone(doc).(*waE2E.DocumentMessage)
			stripped.JPEGThumbnail = nil
			stripped.ContextInfo = nil
			stripped.Caption = nil
			n.MediaDesc, _ = proto.Marshal(&waE2E.Message{DocumentMessage: stripped})
		}
		return n

	case msg.GetImageMessage() != nil:
		img := msg.GetImageMessage()
		n := Normalized{
			Kind:      "image",
			Text:      clip(img.GetCaption()),
			QuotedID:  img.GetContextInfo().GetStanzaID(),
			MediaMime: baseMime(img.GetMimetype()),
			MediaSize: int64(img.GetFileLength()),
		}
		if !isViewOnce && downloadableMime[n.MediaMime] {
			stripped := proto.Clone(img).(*waE2E.ImageMessage)
			stripped.JPEGThumbnail = nil
			stripped.ContextInfo = nil
			stripped.Caption = nil
			n.MediaDesc, _ = proto.Marshal(&waE2E.Message{ImageMessage: stripped})
		}
		return n

	case msg.GetVideoMessage() != nil:
		v := msg.GetVideoMessage()
		return Normalized{Kind: "video", Text: clip(v.GetCaption()), QuotedID: v.GetContextInfo().GetStanzaID()}

	case msg.GetAudioMessage() != nil:
		return Normalized{Kind: "audio"}
	}
	return Normalized{Skip: true}
}

// MediaFromDescriptor reverses the descriptor stored by Normalize.
func MediaFromDescriptor(desc []byte) (doc *waE2E.DocumentMessage, img *waE2E.ImageMessage, err error) {
	var m waE2E.Message
	if err := proto.Unmarshal(desc, &m); err != nil {
		return nil, nil, err
	}
	return m.GetDocumentMessage(), m.GetImageMessage(), nil
}

func clip(s string) string {
	s = strings.ToValidUTF8(s, "")
	if utf8.RuneCountInString(s) <= maxTextRunes {
		return s
	}
	r := []rune(s)
	return string(r[:maxTextRunes])
}

func baseMime(m string) string {
	m = strings.ToLower(strings.TrimSpace(m))
	if i := strings.IndexByte(m, ';'); i >= 0 {
		m = strings.TrimSpace(m[:i])
	}
	return m
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// cleanFileName keeps a display-safe base name (no paths, control chars, or excessive length).
func cleanFileName(name string) string {
	name = strings.ToValidUTF8(name, "")
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > 200 {
		name = string([]rune(name)[:200])
	}
	return name
}
