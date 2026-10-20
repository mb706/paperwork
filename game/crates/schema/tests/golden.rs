//! Golden composite fixtures, Rust side (test/codec/golden.test.ts writes them from the TypeScript side):
//! - closure.bin: the preflight accepts it, ClosureIter walks it, every action decodes to the value the
//!   TypeScript test encoded, and each re-encodes to its bytes;
//! - packet.bin: PacketBuilder, write_event and write_ui_record write exactly these bytes from the same
//!   content (the sim writes packets, the main thread decodes them);
//! - closure-log.bin: ClosureLog::parse reads it.
#![allow(clippy::disallowed_methods)] // a test reads its fixtures

use schema::codec::{Fixed, List, Packed, Writer};
use schema::container::{ClosureLog, ClosureLogFlags};
use schema::events::{
    EntityBuiltEvent, EntityBuiltFlags, EventFlags, EventHeader, EventPayload, EventType, FlyingTextEvent,
    write_event,
};
use schema::packet::{Dyn, Mover, PacketBuilder, PacketFlags, PacketSection};
use schema::projections::{AlertCount, Hud, HudFlags, ProjectionKind, UiStatus, write_ui_record};
use schema::types::{
    AlertType, BuildFlags, BuildMode, Direction, DynState, EntityId, EntityRef, EntityRefTag, FinePos,
    FlyingText, ItemKey, JoinFlags, MoverFlags, MoverKind, PlayerIndex, RecipeId, Seq, Serial, TechId, Tick,
    TilePos2,
};
use schema::{
    Action, BuildAction, ClosureIter, CraftAction, PLAYERS, PlayerJoinedAction, RotateEntityAction,
    StartWalkingAction, preflight,
};
use std::fs;
use std::path::Path;

fn golden(name: &str) -> Vec<u8> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/codec/golden").join(name);
    fs::read(&p).unwrap_or_else(|e| {
        panic!("{}: {e} (UPDATE_GOLDEN=1 npx vitest run test/codec/golden.test.ts)", p.display())
    })
}

#[test]
fn closure_bin() {
    let bytes = golden("closure.bin");
    let mut last = [0u32; PLAYERS];
    last[0] = 4;
    let s = preflight(&bytes, 7, &last, 0, &|_| false).expect("the preflight accepts the closure");
    assert_eq!((s.batches, s.actions), (3, 5));
    let want = [
        Action::StartWalking(StartWalkingAction { input_gen: 3, dir: Direction::East }),
        Action::Build(BuildAction {
            item: ItemKey(2 << 3),
            pos: TilePos2 { x2: 5, y2: -7 },
            dir: Direction::South,
            flip: false,
            mode: BuildMode::Normal,
            flags: BuildFlags::EMPTY,
            drag_id: 0,
        }),
        Action::Craft(CraftAction { recipe: RecipeId(0), count: 2 }),
        Action::RotateEntity(RotateEntityAction {
            target: EntityRef { a: 12345, b: 0, tag: EntityRefTag::Serial },
            reverse: true,
        }),
        Action::PlayerJoined(PlayerJoinedAction { player: PlayerIndex(3), flags: JoinFlags::EMPTY }),
    ];
    let who: Vec<(u16, u32, bool)> =
        ClosureIter::new(&bytes).map(|a| (a.player.0, a.seq, a.system)).collect();
    assert_eq!(who, [(0, 5, false), (0, 6, false), (0, 7, false), (3, 1, false), (0xFFFF, 1, true)]);
    for (a, want) in ClosureIter::new(&bytes).zip(want) {
        let got = Action::decode(a.ty, a.payload).expect("decodes");
        assert_eq!(got, want);
        let mut out = Vec::new();
        got.encode_framed(&mut Writer::new(&mut out)).expect("encodes");
        assert_eq!(&out[4..], a.payload);
    }
    // Rule 4 (D21): the same closure after player 0's watermark has passed seq 5 is refused.
    last[0] = 5;
    assert!(preflight(&bytes, 7, &last, 0, &|_| false).is_err());
}

#[test]
fn packet_bin() {
    let want = golden("packet.bin");
    let dyns = [
        Dyn {
            x2: 5,
            y2: -7,
            serial: Serial(12345),
            proto: EntityId(0),
            phase: 0x4000,
            dir: Direction::South,
            state: DynState::Working,
            light: 0,
            quality: 0,
        },
        Dyn {
            x2: -1,
            y2: 1,
            serial: Serial(7),
            proto: EntityId(0),
            phase: 0,
            dir: Direction::North,
            state: DynState::Idle,
            light: 255,
            quality: 1,
        },
    ];
    let mover = Mover {
        serial: Serial(1),
        proto: EntityId(1),
        kind: MoverKind::Character,
        flags: MoverFlags::EMPTY,
        x: -256,
        y: 512,
        vx: 38,
        vy: 0,
        base_tick: Tick(7),
        orientation: 0x4000,
        aux: 0,
    };
    let alerts = [AlertCount { alert: AlertType::EntityDestroyed, count: 2 }];
    let hud = Hud {
        tick: Tick(7),
        research_tech: TechId(0xFFFF),
        research_level: 0,
        research_progress: 0.0,
        takeoff_level: 0,
        flags: HudFlags::CLOSED,
        field: 1.5,
        literature: 1945.0,
        your_year: 1945.25,
        years_ahead: -0.5,
        activity_w: 0.0,
        doubling_time_s: 0.0,
        alerts: List::from_slice(&alerts),
    };
    let header = |seq: u32, flags: EventFlags, ty: EventType| EventHeader {
        r#type: ty,
        len: 0,
        tick: Tick(7),
        seq: Seq(seq),
        player: PlayerIndex(0),
        flags,
        surface: 0,
    };
    let mut out = Vec::new();
    let w = &mut Writer::new(&mut out);
    let mut p = PacketBuilder::begin(w, 5, 7, PacketFlags::FULL, 0x8000);
    p.section(w, PacketSection::Dyn).unwrap();
    for d in &dyns {
        d.write(w, "Dyn").unwrap();
    }
    p.end(w, 2).unwrap();
    p.section(w, PacketSection::Movers).unwrap();
    mover.write(w, "Mover").unwrap();
    p.end(w, 1).unwrap();
    p.section(w, PacketSection::Events).unwrap();
    let built = EventPayload::EntityBuilt(EntityBuiltEvent {
        serial: Serial(12345),
        proto: EntityId(0),
        dir: Direction::South,
        flags: EntityBuiltFlags::EMPTY,
        pos: TilePos2 { x2: 5, y2: -7 },
    });
    write_event(w, &header(6, EventFlags::EMPTY, EventType::EntityBuilt), &built).unwrap();
    let text = EventPayload::FlyingText(FlyingTextEvent {
        text: FlyingText::ItemDelta,
        item: ItemKey(2 << 3),
        count: -8,
        total: 0,
        pos: FinePos { x: 1280, y: -1792 },
    });
    write_event(w, &header(7, EventFlags::HISTORICAL, EventType::FlyingText), &text).unwrap();
    p.end(w, 2).unwrap();
    p.section(w, PacketSection::Ui).unwrap();
    write_ui_record(w, 0, ProjectionKind::Hud, UiStatus::Ok, 1, |w| hud.encode(w)).unwrap();
    p.end(w, 1).unwrap();
    p.section(w, PacketSection::AudioWorking).unwrap();
    p.end(w, 0).unwrap();
    p.finish(w).unwrap();
    assert_eq!(out.len(), want.len(), "packet length");
    if let Some(at) = out.iter().zip(&want).position(|(a, b)| a != b) {
        panic!("the Rust packet differs from packet.bin at byte {at}");
    }
}

#[test]
fn closure_log_bin() {
    let bytes = golden("closure-log.bin");
    let log = ClosureLog::parse(&bytes).expect("parses");
    assert_eq!(log.header.flags, ClosureLogFlags::HAS_DIGESTS);
    assert_eq!((log.header.start_tick, log.header.end_tick), (Tick(6), Tick(9)));
    assert_eq!(log.header.start_state_hash, 0x1122_3344_5566_7788);
    assert_eq!(log.records.iter().map(|r| r.tick.0).collect::<Vec<_>>(), [7, 9]);
    assert_eq!(log.records[0].closure, golden("closure.bin").as_slice());
    assert_eq!(log.digests, [0x0123_4567_89ab_cdef, 0xfedc_ba98_7654_3210]);
    assert!(log.blobs.is_empty());
    let mut cut = bytes.clone();
    cut.pop();
    assert!(ClosureLog::parse(&cut).is_err());
}
