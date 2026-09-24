import { describe, expect, it } from "vitest";
import verbsData from "../../../../data/grammar/verbs.json";
import { looksIchidan, verbGroups, type VerbEntry } from "../verbGroups";
import type { VerbClass } from "../conjugate";

const verbs = (verbsData as { verbs: VerbEntry[] }).verbs;
const CLASSES: VerbClass[] = ["godan", "ichidan", "suru", "kuru"];

describe("verbGroups", () => {
  it("puts every verb in exactly one group of its own class", () => {
    for (const cls of CLASSES) {
      const grouped = verbGroups(verbs, cls).flatMap((g) => g.verbs.map((v) => v.surface));
      const expected = verbs.filter((v) => v.class === cls).map((v) => v.surface);
      expect(new Set(grouped).size).toBe(grouped.length);
      expect([...grouped].sort()).toEqual([...expected].sort());
    }
  });

  it("flags the classic look-alike godan verbs and nothing ichidan", () => {
    const byId = new Map(verbs.map((v) => [v.surface, v]));
    for (const s of ["帰る", "入る", "走る", "知る", "切る", "要る", "減る", "しゃべる", "滑る", "蹴る", "握る", "焦る"]) {
      expect(looksIchidan(byId.get(s)!), s).toBe(true);
    }
    for (const s of ["作る", "ある", "分かる", "乗る", "食べる", "見る", "する"]) {
      expect(looksIchidan(byId.get(s)!), s).toBe(false);
    }
  });

  it("groups godan by ending and ichidan by い段／え段", () => {
    const godan = verbGroups(verbs, "godan");
    expect(godan.find((g) => g.key === "く")!.verbs.map((v) => v.surface)).toContain("行く");
    expect(godan.find((g) => g.key === "る")!.verbs.map((v) => v.surface)).not.toContain("帰る");
    const ichidan = verbGroups(verbs, "ichidan");
    expect(ichidan.find((g) => g.key === "i")!.verbs.map((v) => v.surface)).toEqual(
      expect.arrayContaining(["見る", "起きる", "信じる", "できる"]),
    );
    expect(ichidan.find((g) => g.key === "e")!.verbs.map((v) => v.surface)).toEqual(
      expect.arrayContaining(["食べる", "寝る", "出る"]),
    );
  });
});
