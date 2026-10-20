//! R23–R27 (10 §10.8): input fencing (D22), targets by identity (D23), creation ids (S5), offline
//! characters (§5.1) and per-player order (D21), each in its M0 form.

use crate::helpers::*;
use schema::events::EventPayload;
use schema::{Direction, FailReason, PlayerIndex, SimStatus};

/// The `action_failed` reasons among events.
fn refusals(events: &[(schema::events::EventHeader, EventPayload)]) -> Vec<FailReason> {
    events
        .iter()
        .filter_map(|(_, e)| match e {
            EventPayload::ActionFailed(f) => Some(f.reason),
            _ => None,
        })
        .collect()
}

/// R23: a player walking, with a start-walking action stamped for tick 1,010 in flight, is released at tick
/// 1,003: the character stops at 1,003, and the later start is fenced (no movement, an `input_fenced` event).
#[test]
fn r23_input_fencing() {
    let mut s = scenario("r23-input-fencing", 1945);
    s.system(joined(0));
    s.run_until(999);
    s.act(0, walk(Direction::West));
    s.act_at(1010, 0, walk(Direction::North)); // stamped now, scheduled after the release
    s.system_at(1003, release(0));
    s.run_until(1002);
    assert!(s.player(0).walking);
    let x1002 = s.player(0).x;
    s.run(1);
    let at_release = (s.player(0).x, s.player(0).y);
    assert!(!s.player(0).walking, "released at 1,003: stopped at 1,003");
    assert!(at_release.0 == x1002, "a release in tick t stops the character in tick t");
    s.events();
    s.run_until(1015);
    assert_eq!((s.player(0).x, s.player(0).y), at_release, "the fenced start moves nothing");
    let events = s.events();
    let fenced: Vec<_> = events.iter().filter(|(_, e)| matches!(e, EventPayload::InputFenced)).collect();
    assert_eq!(fenced.len(), 1);
    assert_eq!((fenced[0].0.tick.0, fenced[0].0.player), (1010, PlayerIndex(0)));
    // An action stamped after the release applies.
    s.act(0, walk(Direction::North));
    s.run(10);
    assert!(s.player(0).y < at_release.1, "a fresh start walks");
    finish(&s);
}

/// R24: player A mines an entity and player B builds the same prototype in its place in the next tick; A's
/// action naming the old serial fails with `target_gone` and never touches B's entity (M0 has no rotate: a
/// fast transfer and a mining stand for it).
#[test]
fn r24_targets_by_identity() {
    let mut s = scenario("r24-targets-by-identity", 1945);
    s.system(joined(0));
    s.system(joined(1));
    s.run(1);
    let r = recipe(&s, "iron-chest");
    let chest = item(&s, "iron-chest");
    s.act(0, craft(r, 0));
    s.act(1, craft(r, 0));
    s.run(31);
    s.act(0, click_main(0));
    s.act(1, click_main(0));
    s.run(1);
    s.act(0, build(chest, 3, 0));
    s.run(1);
    let old = s.world().entity(schema::Serial(3)).map(|_| schema::Serial(3)).expect("A's chest is serial 3");
    // A mines its chest; B builds on the same tile in the tick after it goes; A's actions name the old serial.
    s.act(0, mine(serial(old.0)));
    while entity_at(&s, old).is_some() {
        s.run(1);
    }
    s.act(1, build(chest, 3, 0));
    s.act(0, fast(serial(old.0)));
    s.act(0, mine(serial(old.0)));
    s.events();
    s.run(1);
    let new = s.world().entities_by_serial();
    assert_eq!(new.len(), 1, "B's chest stands");
    let b = s.world().serial_of(new[0]);
    assert!(b > old, "a new serial for the new chest");
    assert_eq!(refusals(&s.events()), vec![FailReason::TargetGone, FailReason::TargetGone]);
    assert_eq!(s.player(0).mining.mode, sim::r#gen::MiningMode::None, "A mines nothing");
    s.run(30);
    assert!(entity_at(&s, b).is_some(), "B's chest is never mined by A's stale action");
    finish(&s);
}

/// R25: an entity named by creation id before its build is confirmed: a fast transfer into it in the same
/// closure as its build reaches the right one; when the build failed, the action naming it fails cleanly.
#[test]
fn r25_creation_ids() {
    let mut s = scenario("r25-creation-ids", 1945);
    s.system(joined(0));
    s.run(1);
    let r = recipe(&s, "iron-chest");
    let (chest, plate) = (item(&s, "iron-chest"), item(&s, "iron-plate"));
    s.act(0, craft(r, 0));
    s.run(31);
    s.act(0, click_main(0));
    s.run(1);
    // Seq k builds; seq k + 1 picks nothing (the hand emptied); the next closure names the build by creation id.
    let k = s.player(0).last_seq.0 + 1;
    s.act(0, build(chest, 2, 2));
    s.run(1);
    let built = s.world().entities_by_serial();
    assert_eq!(built.len(), 1);
    // A failed build (out of reach) at seq m, then an action naming creation (m, 0): target_gone, no change.
    s.act(0, craft(r, 0)); // no plates: refused, and the hand stays empty
    let m = s.player(0).last_seq.0 + 2;
    s.act(0, build(chest, 40, 0));
    s.act(0, fast(creation(m, 0)));
    s.act(0, fast(creation(k, 0)));
    s.events();
    s.run(1);
    let reasons = refusals(&s.events());
    assert_eq!(
        reasons,
        vec![
            FailReason::NotEnoughIngredients,
            FailReason::NoItemInHand,
            FailReason::TargetGone,
            FailReason::NothingToTransfer
        ],
        "the failed build left no creation entry; the confirmed one resolves to the chest (empty, so nothing to take)"
    );
    assert_eq!(count(&s, 0, plate), 0);
    assert_eq!(s.player(0).creation_ring.len(), 1, "only the build that happened is in the ring");
    finish(&s);
}

/// R26: a player leaves while walking, mining and hand-crafting: the character stays, stops and keeps its
/// inventory; the hand returns to the inventory if it fits; the queue resumes on return.
#[test]
fn r26_offline_characters() {
    let mut s = golden_scenario("r26-offline-characters");
    s.system(joined(1));
    s.run(1);
    let r = recipe(&s, "iron-chest");
    let plate = item(&s, "iron-plate");
    s.act(1, craft(r, 0));
    s.act(1, click_main(0)); // nothing left to pick up after crafting: the hand stays empty
    s.act(1, walk(Direction::South));
    s.run(10);
    let character = s.player(1).character;
    let (x, y) = (s.player(1).x, s.player(1).y);
    let progress = s.player(1).crafting_queue[0].progress;
    s.system(left(1));
    s.run(1);
    let p = s.player(1);
    assert!(!p.online && !p.walking && p.mining.mode == sim::r#gen::MiningMode::None);
    assert_eq!(p.character, character, "the character stays");
    let (x1, y1) = (p.x, p.y);
    // The leave applies in phase 1, before the characters: in the tick it leaves, the character neither walks
    // nor crafts.
    assert_eq!((x1, y1), (x, y), "it stopped in the tick it left");
    let paused = p.crafting_queue[0].progress;
    assert_eq!(paused, progress, "the queue paused in the tick it left");
    assert!(paused > 0.3, "it had crafted for ten ticks");
    s.run(100);
    let p = s.player(1);
    assert_eq!(
        (p.x, p.y, p.crafting_queue[0].progress),
        (x1, y1, paused),
        "offline: no walking, no crafting"
    );
    assert_eq!(count(&s, 1, plate), 0);
    s.system(joined(1));
    s.run(40);
    let p = s.player(1);
    assert_eq!(p.character, character, "the same character back");
    assert!(p.online && p.crafting_queue.is_empty(), "the queue resumed and finished");
    assert_eq!(count(&s, 1, item(&s, "iron-chest")), 1);
    finish(&s);
}

/// R27: a batch whose first seq is not above the player's saved `last_seq` is `ERR_FRAMING`, also right after
/// a save and a load, and changes nothing; the same actions in order apply in send order.
#[test]
fn r27_per_player_order() {
    let mut s = scenario("r27-per-player-order", 1945);
    s.system(joined(0));
    s.run(1);
    // In send order within a tick: walk, then stop, then walk again: the character walks.
    s.act(0, walk(Direction::East));
    s.act(0, stop());
    s.act(0, auto_sort(false));
    s.act(0, auto_sort(true));
    s.run(1);
    assert!(!s.player(0).walking && s.player(0).auto_sort);
    // Replaying the last closure at the next tick reuses spent seqs.
    let t = s.tick();
    let mut stale = s.closures().0[&t].clone();
    stale[4..8].copy_from_slice(&(t + 1).to_le_bytes());
    let before = s.ctx.state_hashes().expect("hash").full;
    let e = s.ctx.tick(&stale).expect_err("stale seqs");
    assert_eq!(e.status, SimStatus::ErrFraming);
    assert_eq!(s.ctx.state_hashes().expect("hash").full, before, "a refused closure changes nothing");
    // After a save and a load, the watermark holds.
    let mut back = sim::testkit::reload(&protos(), &s.ctx).expect("reloads");
    assert_eq!(back.tick(&stale).expect_err("still stale").status, SimStatus::ErrFraming);
    s.run(5);
    finish(&s);
}
