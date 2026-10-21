//! Layouts (10 §10.2; C8): ASCII grids with a legend, shared with the TypeScript tools (`test/layouts/*.txt`,
//! `test/helpers/layout.ts`). A scenario starts from one with [`Scenario::from_layout`](super::Scenario).
//!
//! ```text
//! # legend: C=iron-chest:items=iron-plate*800  i=inserter:E  A=assembling-machine-1:recipe=iron-gear-wheel
//! # a comment
//! C i A . . i C
//! . @ . . . . .
//! ```
//!
//! - A legend line starts with `# legend:` and maps one character to `entity[:dir][:recipe=name][:items=a*n+b*m]`,
//!   tokens separated by spaces; a layout may have several legend lines. `dir` is N, E, S or W (default N).
//! - The grid's rows are the other non-empty lines that do not start with `#`; their cells are single characters
//!   separated by one space. `.` is an empty tile, and `@` the spawn point's tile (0, 0): the grid is placed so
//!   that `@` lands there, or with its top-left cell on tile (1, 1) when it has no `@`.
//! - A multi-tile entity is anchored at its top-left cell; the cells it covers are written `.`.
//! - `items=` fills a container (a fixture: [`Scenario::from_layout`] creates the entities and their contents
//!   directly, then loads the state through `sim_load`, as the benchmark factories do; everything after the start
//!   goes through closures).

use schema::Direction;
use std::collections::BTreeMap;

/// What a legend character stands for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LegendEntry {
    pub entity: String,
    pub dir: Direction,
    pub recipe: Option<String>,
    /// Initial contents of a container: `(item, count)`, in the legend's order.
    pub items: Vec<(String, u32)>,
}

/// One entity of a layout, on its world tile (its footprint's top-left).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placed {
    pub ch: char,
    pub tile: (i32, i32),
    pub entry: LegendEntry,
}

/// A parsed layout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    pub legend: BTreeMap<char, LegendEntry>,
    /// The entities, in reading order (row by row, left to right).
    pub placed: Vec<Placed>,
    /// The grid's size in cells.
    pub width: i32,
    pub height: i32,
    /// The world tile of the grid's top-left cell.
    pub origin: (i32, i32),
}

impl Layout {
    /// The entities a character stands for, in reading order.
    pub fn of(&self, ch: char) -> impl Iterator<Item = &Placed> {
        self.placed.iter().filter(move |p| p.ch == ch)
    }
}

fn direction(s: &str) -> Result<Direction, String> {
    Ok(match s {
        "N" => Direction::North,
        "E" => Direction::East,
        "S" => Direction::South,
        "W" => Direction::West,
        _ => return Err(format!("a direction is N, E, S or W, not {s}")),
    })
}

fn legend_entry(spec: &str) -> Result<LegendEntry, String> {
    let mut parts = spec.split(':');
    let entity = parts.next().filter(|e| !e.is_empty()).ok_or_else(|| format!("{spec}: no entity"))?;
    let mut e =
        LegendEntry { entity: entity.to_owned(), dir: Direction::North, recipe: None, items: Vec::new() };
    for p in parts {
        if let Some(r) = p.strip_prefix("recipe=") {
            e.recipe = Some(r.to_owned());
        } else if let Some(list) = p.strip_prefix("items=") {
            for item in list.split('+') {
                let (name, n) =
                    item.split_once('*').ok_or_else(|| format!("{item}: items are name*count"))?;
                let n: u32 = n.parse().map_err(|_| format!("{item}: a count is a whole number"))?;
                e.items.push((name.to_owned(), n));
            }
        } else {
            e.dir = direction(p)?;
        }
    }
    Ok(e)
}

/// Parses a layout (see the module's documentation).
pub fn parse(text: &str) -> Result<Layout, String> {
    let mut legend = BTreeMap::new();
    let mut rows: Vec<Vec<char>> = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let at = |m: String| format!("line {}: {m}", n + 1);
        let t = line.trim_end();
        if let Some(rest) = t.strip_prefix("# legend:") {
            for tok in rest.split_whitespace() {
                let (c, spec) =
                    tok.split_once('=').ok_or_else(|| at(format!("{tok}: a legend entry is X=entity")))?;
                let mut cs = c.chars();
                let ch = cs.next().ok_or_else(|| at("an empty legend character".to_owned()))?;
                if cs.next().is_some() || ch == '.' || ch == '@' || ch == '#' {
                    return Err(at(format!("{c}: a legend character is one character other than . @ #")));
                }
                if legend.insert(ch, legend_entry(spec).map_err(at)?).is_some() {
                    return Err(at(format!("{ch} is in the legend twice")));
                }
            }
            continue;
        }
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let mut row = Vec::new();
        for cell in t.split(' ') {
            let mut cs = cell.chars();
            match (cs.next(), cs.next()) {
                (Some(c), None) => row.push(c),
                _ => return Err(at(format!("{cell:?}: cells are single characters separated by one space"))),
            }
        }
        rows.push(row);
    }
    let width = rows.iter().map(Vec::len).max().unwrap_or(0) as i32;
    let height = rows.len() as i32;
    let spawn = rows
        .iter()
        .enumerate()
        .find_map(|(y, r)| r.iter().position(|&c| c == '@').map(|x| (x as i32, y as i32)));
    let origin = spawn.map_or((1, 1), |(x, y)| (-x, -y));
    let mut placed = Vec::new();
    for (y, r) in rows.iter().enumerate() {
        for (x, &c) in r.iter().enumerate() {
            if c == '.' || c == '@' {
                continue;
            }
            let entry = legend.get(&c).ok_or_else(|| format!("row {}: {c} is not in the legend", y + 1))?;
            placed.push(Placed {
                ch: c,
                tile: (origin.0 + x as i32, origin.1 + y as i32),
                entry: entry.clone(),
            });
        }
    }
    Ok(Layout { legend, placed, width, height, origin })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_spec_example() {
        let l = parse(
            "# legend: C=iron-chest  i=inserter:E  A=assembler-1:recipe=iron-gear-wheel  >=transport-belt:E\n\
             # legend: E=electric-interface\n\
             C i A . . i C\n\
             . . . . . . .\n\
             . @ . . . . >\n",
        )
        .expect("parses");
        assert_eq!((l.width, l.height, l.origin), (7, 3, (-1, -2)));
        assert_eq!(l.placed.len(), 6);
        assert_eq!(l.placed[0].tile, (-1, -2));
        assert_eq!(l.placed[1].entry.dir, Direction::East);
        assert_eq!(l.placed[2].entry.recipe.as_deref(), Some("iron-gear-wheel"));
        assert_eq!(l.of('C').map(|p| p.tile).collect::<Vec<_>>(), vec![(-1, -2), (5, -2)]);
        assert_eq!(l.placed[5].tile, (5, 0));
    }

    #[test]
    fn reads_contents_and_refuses_mistakes() {
        let l = parse("# legend: C=iron-chest:items=iron-plate*800+iron-ore*5\nC\n").expect("parses");
        assert_eq!(l.origin, (1, 1));
        assert_eq!(l.placed[0].entry.items, vec![("iron-plate".to_owned(), 800), ("iron-ore".to_owned(), 5)]);
        for bad in [
            "C\n",
            "# legend: C=iron-chest C=iron-chest\n",
            "# legend: .=iron-chest\n",
            "# legend: C=iron-chest:Q\nC\n",
            "# legend: C=iron-chest:items=iron-plate\nC\n",
            "# legend: C=iron-chest\nCC\n",
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }
}
