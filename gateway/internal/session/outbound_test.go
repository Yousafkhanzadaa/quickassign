package session

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

type fakeSender struct{ to []types.JID }

func (f *fakeSender) SendMessage(_ context.Context, to types.JID, _ *waE2E.Message, _ ...whatsmeow.SendRequestExtra) (whatsmeow.SendResponse, error) {
	f.to = append(f.to, to)
	return whatsmeow.SendResponse{ID: types.MessageID("ID" + to.User)}, nil
}

var (
	ownPN  = types.NewJID("923001234567", types.DefaultUserServer)
	ownLID = types.NewJID("111122223333", types.HiddenUserServer)
)

func ownFn(pn, lid types.JID) func() (types.JID, types.JID) {
	return func() (types.JID, types.JID) { return pn, lid }
}

func TestSendsOnlyToOwnChat(t *testing.T) {
	f := &fakeSender{}
	pnWithDevice := ownPN
	pnWithDevice.Device = 12
	o := newOutbound(f, ownFn(pnWithDevice, ownLID), 10)
	id, err := o.sendToSelf(context.Background(), &waE2E.Message{Conversation: proto.String("hi")})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.to) != 1 || f.to[0] != ownPN {
		t.Fatalf("sent to %v, want %v", f.to, ownPN)
	}
	if !o.wasSentByUs(id) {
		t.Fatal("sent ID must be remembered")
	}
}

func TestRefusesWhenNotLoggedIn(t *testing.T) {
	f := &fakeSender{}
	o := newOutbound(f, ownFn(types.EmptyJID, types.EmptyJID), 10)
	if _, err := o.sendToSelf(context.Background(), &waE2E.Message{}); err != ErrNotLoggedIn {
		t.Fatalf("got %v, want ErrNotLoggedIn", err)
	}
	if len(f.to) != 0 {
		t.Fatal("nothing must be sent")
	}
}

func TestOwnerCheck(t *testing.T) {
	o := newOutbound(&fakeSender{}, ownFn(ownPN, ownLID), 10)
	cases := map[types.JID]bool{
		ownPN:  true,
		ownLID: true,
		types.NewJID("923009999999", types.DefaultUserServer): false,
		types.NewJID("120363000000000000", types.GroupServer): false,
		types.NewJID("status", types.BroadcastServer):         false,
		types.EmptyJID: false,
	}
	for jid, want := range cases {
		if got := o.isOwner(jid); got != want {
			t.Errorf("isOwner(%v) = %v, want %v", jid, got, want)
		}
	}
}

func TestRateLimit(t *testing.T) {
	f := &fakeSender{}
	o := newOutbound(f, ownFn(ownPN, ownLID), 2)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if _, err := o.sendToSelf(ctx, &waE2E.Message{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := o.sendToSelf(ctx, &waE2E.Message{}); err != ErrRateLimited {
		t.Fatalf("got %v, want ErrRateLimited", err)
	}
	// After the window passes, sending works again.
	base := time.Now()
	o.limiter.now = func() time.Time { return base.Add(2 * time.Hour) }
	if _, err := o.sendToSelf(ctx, &waE2E.Message{}); err != nil {
		t.Fatalf("expected send after window, got %v", err)
	}
}

// TestOnlyOutboundSends is a static invariant: across the whole gateway, nothing except
// outbound.go may call SendMessage, and nothing may call APIs that would mark messages
// read, reveal presence, or join/leave/modify groups.
func TestOnlyOutboundSends(t *testing.T) {
	forbidden := map[string]bool{
		"MarkRead": true, "SendPresence": true, "SendChatPresence": true, "SubscribePresence": true,
		"JoinGroupWithLink": true, "JoinGroupWithInvite": true, "LeaveGroup": true,
		"UpdateGroupParticipants": true, "SetGroupName": true, "SetGroupTopic": true,
		"CreateGroup": true, "SendMediaRetryReceipt": true, "SetStatusMessage": true,
		"RevokeMessage": true, "SendFBMessage": true, "SendPeerMessage": true,
	}
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			name := sel.Sel.Name
			if forbidden[name] {
				t.Errorf("%s: forbidden call/reference to %s", fset.Position(sel.Pos()), name)
			}
			if name == "SendMessage" && filepath.Base(path) != "outbound.go" {
				t.Errorf("%s: SendMessage may only be used in outbound.go", fset.Position(sel.Pos()))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
