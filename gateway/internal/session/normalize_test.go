package session

import (
	"strings"
	"testing"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestNormalizeText(t *testing.T) {
	n := Normalize(&waE2E.Message{Conversation: proto.String("Assignment 2 due Friday")}, false)
	if n.Skip || n.Kind != "text" || n.Text != "Assignment 2 due Friday" {
		t.Fatalf("unexpected %+v", n)
	}
}

func TestNormalizeReplyKeepsQuotedID(t *testing.T) {
	n := Normalize(&waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text:        proto.String("deadline extended to Wednesday"),
		ContextInfo: &waE2E.ContextInfo{StanzaID: proto.String("ABC123")},
	}}, false)
	if n.QuotedID != "ABC123" || n.Kind != "text" {
		t.Fatalf("unexpected %+v", n)
	}
}

func TestNormalizeDocumentStripsThumbnailAndKeepsKeys(t *testing.T) {
	doc := &waE2E.DocumentMessage{
		FileName:      proto.String("../../Assignment_3.pdf"),
		Caption:       proto.String("Solve Q1-Q5"),
		Mimetype:      proto.String("application/pdf"),
		FileLength:    proto.Uint64(123456),
		DirectPath:    proto.String("/v/t62/abc"),
		MediaKey:      []byte{1, 2, 3},
		FileSHA256:    []byte{4},
		FileEncSHA256: []byte{5},
		JPEGThumbnail: []byte("thumbnail-bytes"),
	}
	n := Normalize(&waE2E.Message{DocumentMessage: doc}, false)
	if n.Kind != "document" || n.FileName != "Assignment_3.pdf" || n.Text != "Solve Q1-Q5" || n.MediaSize != 123456 {
		t.Fatalf("unexpected %+v", n)
	}
	if len(n.MediaDesc) == 0 {
		t.Fatal("expected a media descriptor")
	}
	if strings.Contains(string(n.MediaDesc), "thumbnail-bytes") || strings.Contains(string(n.MediaDesc), "Solve Q1-Q5") {
		t.Fatal("descriptor must not contain the thumbnail or caption")
	}
	gotDoc, gotImg, err := MediaFromDescriptor(n.MediaDesc)
	if err != nil || gotImg != nil || gotDoc.GetDirectPath() != "/v/t62/abc" || string(gotDoc.GetMediaKey()) != string([]byte{1, 2, 3}) {
		t.Fatalf("descriptor round trip failed: %v", err)
	}
}

func TestNormalizeUnsupportedMimeHasNoDescriptor(t *testing.T) {
	n := Normalize(&waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
		FileName: proto.String("setup.exe"), Mimetype: proto.String("application/x-msdownload"),
	}}, false)
	if n.Kind != "document" || len(n.MediaDesc) != 0 {
		t.Fatalf("executables must never be downloadable: %+v", n)
	}
}

func TestNormalizeViewOnceIsNeverDownloadable(t *testing.T) {
	n := Normalize(&waE2E.Message{ImageMessage: &waE2E.ImageMessage{Mimetype: proto.String("image/jpeg")}}, true)
	if len(n.MediaDesc) != 0 {
		t.Fatal("view-once media must not be stored")
	}
}

func TestNormalizeRevokeAndEdit(t *testing.T) {
	rev := Normalize(&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type: waE2E.ProtocolMessage_REVOKE.Enum(), Key: &waCommon.MessageKey{ID: proto.String("M1")},
	}}, false)
	if rev.RevokeOf != "M1" {
		t.Fatalf("unexpected revoke %+v", rev)
	}
	edit := Normalize(&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type:          waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(),
		Key:           &waCommon.MessageKey{ID: proto.String("M2")},
		EditedMessage: &waE2E.Message{Conversation: proto.String("due Thursday now")},
	}}, false)
	if edit.EditOf != "M2" || edit.Text != "due Thursday now" {
		t.Fatalf("unexpected edit %+v", edit)
	}
}

func TestNormalizeSkipsNoise(t *testing.T) {
	for name, m := range map[string]*waE2E.Message{
		"reaction": {ReactionMessage: &waE2E.ReactionMessage{Text: proto.String("👍")}},
		"sticker":  {StickerMessage: &waE2E.StickerMessage{}},
		"nil":      nil,
		"empty":    {},
		"blank":    {ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("   ")}},
	} {
		if !Normalize(m, false).Skip {
			t.Errorf("%s should be skipped", name)
		}
	}
}

func TestClipLimitsText(t *testing.T) {
	long := strings.Repeat("ب", maxTextRunes+50)
	if got := Normalize(&waE2E.Message{Conversation: proto.String(long)}, false); len([]rune(got.Text)) != maxTextRunes {
		t.Fatalf("expected clip to %d runes", maxTextRunes)
	}
}
