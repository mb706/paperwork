//! R29 (10 §10.8; D11), M0's case: two players with different auto-sort settings; each inventory sorts by its
//! owner's setting. (Its client-only half, smart belts and even distribution changing only which actions are
//! sent, is the UI's.)

use crate::helpers::*;

#[test]
fn r29_per_player_settings() {
    let mut s = golden_scenario("r29-per-player-settings");
    s.system(joined(1));
    s.run(1);
    s.act(1, auto_sort(false));
    s.run(1);
    assert!(s.player(0).auto_sort && !s.player(1).auto_sort);
    // Both move their first stack to slot 9: pick it up, put it down.
    for i in [0, 1] {
        s.act(i, click_main(0));
        s.act(i, click_main(9));
    }
    s.run(1);
    let slot = |s: &sim::testkit::Scenario, i: u16, k: usize| {
        let p = s.player(i);
        s.world().heap.block(p.main)[k]
    };
    assert!(slot(&s, 0, 0).count > 0 && slot(&s, 0, 9).count == 0, "auto-sort on: the stack is sorted back");
    assert!(
        slot(&s, 1, 0).count == 0 && slot(&s, 1, 9).count > 0,
        "auto-sort off: it stays where it was put"
    );
    // Turning it on sorts the inventory at once.
    s.act(1, auto_sort(true));
    s.run(1);
    assert!(slot(&s, 1, 0).count > 0 && slot(&s, 1, 9).count == 0);
    finish(&s);
}
