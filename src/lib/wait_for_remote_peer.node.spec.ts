import { expect } from "chai";

import { makeLogFileName, NOISE_KEY_1, Nwaku } from "../test_utils";
import { delay } from "../test_utils/delay";

import { createLightNode, createPrivacyNode } from "./create_waku";
import type { WakuLight, WakuPrivacy } from "./interfaces";
import { waitForRemotePeer } from "./wait_for_remote_peer";
import { Protocols } from "./waku";

describe("Wait for remote peer", function () {
  let waku1: WakuPrivacy;
  let waku2: WakuLight;
  let nwaku: Nwaku | undefined;

  afterEach(async function () {
    if (nwaku) {
      nwaku.stop();
      nwaku = undefined;
    }
    waku1?.stop().catch((e) => console.log("Waku failed to stop", e));
    waku2?.stop().catch((e) => console.log("Waku failed to stop", e));
  });

  it("Relay - dialed first", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      relay: true,
      store: false,
      filter: false,
      lightpush: false,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku1 = await createPrivacyNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku1.start();
    await waku1.dial(multiAddrWithId);
    await delay(1000);
    await waitForRemotePeer(waku1, [Protocols.Relay]);
    const peers = waku1.relay.getMeshPeers();
    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(peers).to.includes(nimPeerId);
  });

  it("Relay - dialed after", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      relay: true,
      store: false,
      filter: false,
      lightpush: false,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku1 = await createPrivacyNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku1.start();

    const waitPromise = waitForRemotePeer(waku1, [Protocols.Relay]);
    await delay(1000);
    await waku1.dial(multiAddrWithId);
    await waitPromise;

    const peers = waku1.relay.getMeshPeers();
    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(peers).includes(nimPeerId);
  });

  it("Relay - times out", function (done) {
    this.timeout(5000);
    createPrivacyNode({
      staticNoiseKey: NOISE_KEY_1,
    })
      .then((waku1) => waku1.start().then(() => waku1))
      .then((waku1) => {
        waitForRemotePeer(waku1, [Protocols.Relay], 200).then(
          () => {
            throw "Promise expected to reject on time out";
          },
          (reason) => {
            expect(reason).to.eq("Timed out waiting for a remote peer.");
            done();
          }
        );
      });
  });

  it("Store - dialed first", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      store: true,
      relay: false,
      lightpush: false,
      filter: false,
      persistMessages: true,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku2 = await createLightNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku2.start();
    await waku2.dial(multiAddrWithId);
    await delay(1000);
    await waitForRemotePeer(waku2, [Protocols.Store]);

    const peers = (await waku2.store.peers()).map((peer) => peer.id.toString());
    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(peers.includes(nimPeerId as string)).to.be.true;
  });

  it("Store - dialed after - with timeout", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      store: true,
      relay: false,
      lightpush: false,
      filter: false,
      persistMessages: true,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku2 = await createLightNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku2.start();
    const waitPromise = waitForRemotePeer(waku2, [Protocols.Store], 2000);
    await delay(1000);
    await waku2.dial(multiAddrWithId);
    await waitPromise;

    const peers = (await waku2.store.peers()).map((peer) => peer.id.toString());

    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(peers.includes(nimPeerId as string)).to.be.true;
  });

  it("LightPush", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      lightpush: true,
      filter: false,
      relay: false,
      store: false,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku2 = await createLightNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku2.start();
    await waku2.dial(multiAddrWithId);
    await waitForRemotePeer(waku2, [Protocols.LightPush]);

    const peers = (await waku2.lightPush.peers()).map((peer) =>
      peer.id.toString()
    );

    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(peers.includes(nimPeerId as string)).to.be.true;
  });

  it("Filter", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      filter: true,
      lightpush: false,
      relay: false,
      store: false,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku2 = await createLightNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku2.start();
    await waku2.dial(multiAddrWithId);
    await waitForRemotePeer(waku2, [Protocols.Filter]);

    const peers = (await waku2.filter.peers()).map((peer) =>
      peer.id.toString()
    );

    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(peers.includes(nimPeerId as string)).to.be.true;
  });

  it("Light Node - default protocols", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      filter: true,
      lightpush: true,
      relay: false,
      store: true,
      persistMessages: true,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku2 = await createLightNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku2.start();
    await waku2.dial(multiAddrWithId);
    await waitForRemotePeer(waku2);

    const filterPeers = (await waku2.filter.peers()).map((peer) =>
      peer.id.toString()
    );
    const storePeers = (await waku2.store.peers()).map((peer) =>
      peer.id.toString()
    );
    const lightPushPeers = (await waku2.lightPush.peers()).map((peer) =>
      peer.id.toString()
    );

    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(filterPeers.includes(nimPeerId as string)).to.be.true;
    expect(storePeers.includes(nimPeerId as string)).to.be.true;
    expect(lightPushPeers.includes(nimPeerId as string)).to.be.true;
  });

  it("Privacy Node - default protocol", async function () {
    this.timeout(20_000);
    nwaku = new Nwaku(makeLogFileName(this));
    await nwaku.start({
      filter: false,
      lightpush: false,
      relay: true,
      store: false,
    });
    const multiAddrWithId = await nwaku.getMultiaddrWithId();

    waku1 = await createPrivacyNode({
      staticNoiseKey: NOISE_KEY_1,
    });
    await waku1.start();
    await waku1.dial(multiAddrWithId);
    await waitForRemotePeer(waku1);

    const peers = await waku1.relay.getMeshPeers();

    const nimPeerId = multiAddrWithId.getPeerId();

    expect(nimPeerId).to.not.be.undefined;
    expect(peers.includes(nimPeerId as string)).to.be.true;
  });
});
