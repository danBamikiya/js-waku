import { PeerId } from "@libp2p/interface-peer-id";
import { expect } from "chai";
import debug from "debug";

import {
  makeLogFileName,
  MessageRpcResponse,
  NOISE_KEY_1,
  NOISE_KEY_2,
  NOISE_KEY_3,
  Nwaku,
} from "../../test_utils";
import { delay } from "../../test_utils/delay";
import { DefaultPubSubTopic } from "../constants";
import { createPrivacyNode } from "../create_waku";
import {
  generatePrivateKey,
  generateSymmetricKey,
  getPublicKey,
} from "../crypto";
import type { Message, WakuPrivacy } from "../interfaces";
import { bytesToUtf8, utf8ToBytes } from "../utils";
import { waitForRemotePeer } from "../wait_for_remote_peer";
import { Protocols } from "../waku";
import { DecoderV0, EncoderV0, MessageV0 } from "../waku_message/version_0.js";
import {
  AsymDecoder,
  AsymEncoder,
  SymDecoder,
  SymEncoder,
} from "../waku_message/version_1.js";

const log = debug("waku:test");

const TestContentTopic = "/test/1/waku-relay/utf8";
const TestEncoder = new EncoderV0(TestContentTopic);
const TestDecoder = new DecoderV0(TestContentTopic);

describe("Waku Relay [node only]", () => {
  // Node needed as we don't have a way to connect 2 js waku
  // nodes in the browser yet
  describe("2 js nodes", () => {
    afterEach(function () {
      if (this.currentTest?.state === "failed") {
        console.log(`Test failed, log file name is ${makeLogFileName(this)}`);
      }
    });

    let waku1: WakuPrivacy;
    let waku2: WakuPrivacy;
    beforeEach(async function () {
      this.timeout(10000);

      log("Starting JS Waku instances");
      [waku1, waku2] = await Promise.all([
        createPrivacyNode({ staticNoiseKey: NOISE_KEY_1 }).then((waku) =>
          waku.start().then(() => waku)
        ),
        createPrivacyNode({
          staticNoiseKey: NOISE_KEY_2,
          libp2p: { addresses: { listen: ["/ip4/0.0.0.0/tcp/0/ws"] } },
        }).then((waku) => waku.start().then(() => waku)),
      ]);
      log("Instances started, adding waku2 to waku1's address book");
      waku1.addPeerToAddressBook(
        waku2.libp2p.peerId,
        waku2.libp2p.getMultiaddrs()
      );

      log("Wait for mutual pubsub subscription");
      await Promise.all([
        waitForRemotePeer(waku1, [Protocols.Relay]),
        waitForRemotePeer(waku2, [Protocols.Relay]),
      ]);
      log("before each hook done");
    });

    afterEach(async function () {
      !!waku1 &&
        waku1.stop().catch((e) => console.log("Waku failed to stop", e));
      !!waku2 &&
        waku2.stop().catch((e) => console.log("Waku failed to stop", e));
    });

    it("Subscribe", async function () {
      log("Getting subscribers");
      const subscribers1 = waku1.libp2p.pubsub
        .getSubscribers(DefaultPubSubTopic)
        .map((p) => p.toString());
      const subscribers2 = waku2.libp2p.pubsub
        .getSubscribers(DefaultPubSubTopic)
        .map((p) => p.toString());

      log("Asserting mutual subscription");
      expect(subscribers1).to.contain(waku2.libp2p.peerId.toString());
      expect(subscribers2).to.contain(waku1.libp2p.peerId.toString());
    });

    it("Register correct protocols", async function () {
      const protocols = waku1.libp2p.registrar.getProtocols();

      expect(protocols).to.contain("/vac/waku/relay/2.0.0");
      expect(protocols.findIndex((value) => value.match(/sub/))).to.eq(-1);
    });

    it("Publish", async function () {
      this.timeout(10000);

      const messageText = "JS to JS communication works";
      const messageTimestamp = new Date("1995-12-17T03:24:00");
      const message = {
        payload: utf8ToBytes(messageText),
        timestamp: messageTimestamp,
      };

      const receivedMsgPromise: Promise<Message> = new Promise((resolve) => {
        waku2.relay.addObserver(TestDecoder, resolve);
      });

      await waku1.relay.send(TestEncoder, message);

      const receivedMsg = await receivedMsgPromise;

      expect(receivedMsg.contentTopic).to.eq(TestContentTopic);
      expect(bytesToUtf8(receivedMsg.payload!)).to.eq(messageText);
      expect(receivedMsg.timestamp?.valueOf()).to.eq(
        messageTimestamp.valueOf()
      );
    });

    it("Filter on content topics", async function () {
      this.timeout(10000);

      const fooMessageText = "Published on content topic foo";
      const barMessageText = "Published on content topic bar";

      const fooContentTopic = "foo";
      const barContentTopic = "bar";

      const fooEncoder = new EncoderV0(fooContentTopic);
      const barEncoder = new EncoderV0(barContentTopic);

      const fooDecoder = new DecoderV0(fooContentTopic);
      const barDecoder = new DecoderV0(barContentTopic);

      const fooMessages: Message[] = [];
      waku2.relay.addObserver(fooDecoder, (msg) => {
        fooMessages.push(msg);
      });

      const barMessages: Message[] = [];
      waku2.relay.addObserver(barDecoder, (msg) => {
        barMessages.push(msg);
      });

      await waku1.relay.send(barEncoder, {
        payload: utf8ToBytes(barMessageText),
      });
      await waku1.relay.send(fooEncoder, {
        payload: utf8ToBytes(fooMessageText),
      });

      await delay(200);

      expect(fooMessages[0].contentTopic).to.eq(fooContentTopic);
      expect(bytesToUtf8(fooMessages[0].payload!)).to.eq(fooMessageText);

      expect(barMessages[0].contentTopic).to.eq(barContentTopic);
      expect(bytesToUtf8(barMessages[0].payload!)).to.eq(barMessageText);

      expect(fooMessages.length).to.eq(1);
      expect(barMessages.length).to.eq(1);
    });

    it("Decrypt messages", async function () {
      this.timeout(10000);

      const asymText = "This message is encrypted using asymmetric";
      const asymTopic = "/test/1/asymmetric/proto";
      const symText = "This message is encrypted using symmetric encryption";
      const symTopic = "/test/1/symmetric/proto";

      const privateKey = generatePrivateKey();
      const symKey = generateSymmetricKey();
      const publicKey = getPublicKey(privateKey);

      const asymEncoder = new AsymEncoder(asymTopic, publicKey);
      const symEncoder = new SymEncoder(symTopic, symKey);

      const asymDecoder = new AsymDecoder(asymTopic, privateKey);
      const symDecoder = new SymDecoder(symTopic, symKey);

      const msgs: Message[] = [];
      waku2.relay.addObserver(asymDecoder, (wakuMsg) => {
        msgs.push(wakuMsg);
      });
      waku2.relay.addObserver(symDecoder, (wakuMsg) => {
        msgs.push(wakuMsg);
      });

      await waku1.relay.send(asymEncoder, { payload: utf8ToBytes(asymText) });
      await delay(200);
      await waku1.relay.send(symEncoder, { payload: utf8ToBytes(symText) });

      while (msgs.length < 2) {
        await delay(200);
      }

      expect(msgs[0].contentTopic).to.eq(asymTopic);
      expect(bytesToUtf8(msgs[0].payload!)).to.eq(asymText);
      expect(msgs[1].contentTopic).to.eq(symTopic);
      expect(bytesToUtf8(msgs[1].payload!)).to.eq(symText);
    });

    it("Delete observer", async function () {
      this.timeout(10000);

      const messageText =
        "Published on content topic with added then deleted observer";

      const contentTopic = "added-then-deleted-observer";

      // The promise **fails** if we receive a message on this observer.
      const receivedMsgPromise: Promise<Message> = new Promise(
        (resolve, reject) => {
          const deleteObserver = waku2.relay.addObserver(
            new DecoderV0(contentTopic),
            reject
          );
          deleteObserver();
          setTimeout(resolve, 500);
        }
      );
      await waku1.relay.send(new EncoderV0(contentTopic), {
        payload: utf8ToBytes(messageText),
      });

      await receivedMsgPromise;
      // If it does not throw then we are good.
    });
  });

  describe("Custom pubsub topic", () => {
    let waku1: WakuPrivacy;
    let waku2: WakuPrivacy;
    let waku3: WakuPrivacy;
    afterEach(async function () {
      !!waku1 &&
        waku1.stop().catch((e) => console.log("Waku failed to stop", e));
      !!waku2 &&
        waku2.stop().catch((e) => console.log("Waku failed to stop", e));
      !!waku3 &&
        waku3.stop().catch((e) => console.log("Waku failed to stop", e));
    });

    it("Publish", async function () {
      this.timeout(10000);

      const pubSubTopic = "/some/pubsub/topic";

      // 1 and 2 uses a custom pubsub
      // 3 uses the default pubsub
      [waku1, waku2, waku3] = await Promise.all([
        createPrivacyNode({
          pubSubTopic: pubSubTopic,
          staticNoiseKey: NOISE_KEY_1,
        }).then((waku) => waku.start().then(() => waku)),
        createPrivacyNode({
          pubSubTopic: pubSubTopic,
          staticNoiseKey: NOISE_KEY_2,
          libp2p: { addresses: { listen: ["/ip4/0.0.0.0/tcp/0/ws"] } },
        }).then((waku) => waku.start().then(() => waku)),
        createPrivacyNode({
          staticNoiseKey: NOISE_KEY_3,
        }).then((waku) => waku.start().then(() => waku)),
      ]);

      waku1.addPeerToAddressBook(
        waku2.libp2p.peerId,
        waku2.libp2p.getMultiaddrs()
      );
      waku3.addPeerToAddressBook(
        waku2.libp2p.peerId,
        waku2.libp2p.getMultiaddrs()
      );

      await Promise.all([
        waitForRemotePeer(waku1, [Protocols.Relay]),
        waitForRemotePeer(waku2, [Protocols.Relay]),
      ]);

      const messageText = "Communicating using a custom pubsub topic";

      const waku2ReceivedMsgPromise: Promise<Message> = new Promise(
        (resolve) => {
          waku2.relay.addObserver(TestDecoder, resolve);
        }
      );

      // The promise **fails** if we receive a message on the default
      // pubsub topic.
      const waku3NoMsgPromise: Promise<Message> = new Promise(
        (resolve, reject) => {
          waku3.relay.addObserver(TestDecoder, reject);
          setTimeout(resolve, 1000);
        }
      );

      await waku1.relay.send(TestEncoder, {
        payload: utf8ToBytes(messageText),
      });

      const waku2ReceivedMsg = await waku2ReceivedMsgPromise;
      await waku3NoMsgPromise;

      expect(bytesToUtf8(waku2ReceivedMsg.payload!)).to.eq(messageText);
    });
  });

  describe("Interop: nwaku", function () {
    let waku: WakuPrivacy;
    let nwaku: Nwaku;

    beforeEach(async function () {
      this.timeout(30_000);
      waku = await createPrivacyNode({
        staticNoiseKey: NOISE_KEY_1,
      });
      await waku.start();

      nwaku = new Nwaku(this.test?.ctx?.currentTest?.title + "");
      await nwaku.start();

      await waku.dial(await nwaku.getMultiaddrWithId());
      await waitForRemotePeer(waku, [Protocols.Relay]);
    });

    afterEach(async function () {
      !!nwaku && nwaku.stop();
      !!waku && waku.stop().catch((e) => console.log("Waku failed to stop", e));
    });

    it("nwaku subscribes", async function () {
      let subscribers: PeerId[] = [];

      while (subscribers.length === 0) {
        await delay(200);
        subscribers = waku.libp2p.pubsub.getSubscribers(DefaultPubSubTopic);
      }

      const nimPeerId = await nwaku.getPeerId();
      expect(subscribers.map((p) => p.toString())).to.contain(
        nimPeerId.toString()
      );
    });

    it("Publishes to nwaku", async function () {
      this.timeout(30000);

      const messageText = "This is a message";
      await waku.relay.send(TestEncoder, { payload: utf8ToBytes(messageText) });

      let msgs: MessageRpcResponse[] = [];

      while (msgs.length === 0) {
        console.log("Waiting for messages");
        await delay(200);
        msgs = await nwaku.messages();
      }

      expect(msgs[0].contentTopic).to.equal(TestContentTopic);
      expect(msgs[0].version).to.equal(0);
      expect(bytesToUtf8(new Uint8Array(msgs[0].payload))).to.equal(
        messageText
      );
    });

    it("Nwaku publishes", async function () {
      await delay(200);

      const messageText = "Here is another message.";

      const receivedMsgPromise: Promise<MessageV0> = new Promise((resolve) => {
        waku.relay.addObserver(TestDecoder, (msg) =>
          resolve(msg as unknown as MessageV0)
        );
      });

      await nwaku.sendMessage(
        Nwaku.toMessageRpcQuery({
          contentTopic: TestContentTopic,
          payload: utf8ToBytes(messageText),
        })
      );

      const receivedMsg = await receivedMsgPromise;

      expect(receivedMsg.contentTopic).to.eq(TestContentTopic);
      expect(receivedMsg.version).to.eq(0);
      expect(bytesToUtf8(receivedMsg.payload!)).to.eq(messageText);
    });

    describe.skip("Two nodes connected to nwaku", function () {
      let waku1: WakuPrivacy;
      let waku2: WakuPrivacy;
      let nwaku: Nwaku;

      afterEach(async function () {
        !!nwaku && nwaku.stop();
        !!waku1 &&
          waku1.stop().catch((e) => console.log("Waku failed to stop", e));
        !!waku2 &&
          waku2.stop().catch((e) => console.log("Waku failed to stop", e));
      });

      it("Js publishes, other Js receives", async function () {
        this.timeout(60_000);
        [waku1, waku2] = await Promise.all([
          createPrivacyNode({
            staticNoiseKey: NOISE_KEY_1,
            emitSelf: true,
          }).then((waku) => waku.start().then(() => waku)),
          createPrivacyNode({
            staticNoiseKey: NOISE_KEY_2,
          }).then((waku) => waku.start().then(() => waku)),
        ]);

        nwaku = new Nwaku(makeLogFileName(this));
        await nwaku.start();

        const nwakuMultiaddr = await nwaku.getMultiaddrWithId();
        await Promise.all([
          waku1.dial(nwakuMultiaddr),
          waku2.dial(nwakuMultiaddr),
        ]);

        // Wait for identify protocol to finish
        await Promise.all([
          waitForRemotePeer(waku1, [Protocols.Relay]),
          waitForRemotePeer(waku2, [Protocols.Relay]),
        ]);

        await delay(2000);
        // Check that the two JS peers are NOT directly connected
        expect(await waku1.libp2p.peerStore.has(waku2.libp2p.peerId)).to.be
          .false;
        expect(waku2.libp2p.peerStore.has(waku1.libp2p.peerId)).to.be.false;

        const msgStr = "Hello there!";
        const message = { payload: utf8ToBytes(msgStr) };

        const waku2ReceivedMsgPromise: Promise<Message> = new Promise(
          (resolve) => {
            waku2.relay.addObserver(TestDecoder, resolve);
          }
        );

        await waku1.relay.send(TestEncoder, message);
        console.log("Waiting for message");
        const waku2ReceivedMsg = await waku2ReceivedMsgPromise;

        expect(waku2ReceivedMsg.payload).to.eq(msgStr);
      });
    });
  });
});
