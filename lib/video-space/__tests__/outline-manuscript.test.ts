import { expect, it } from "vitest";
import { editDraft, spaceSchema, type Draft } from "../contract";
import { reviseOutline, writeOutlineBody } from "../outline-manuscript";

it("keeps cited, formatted prose attached through manual outline edits, removal and restoration", () => {
  const finding = crypto.randomUUID();
  const legacy: Draft = { id:"plan", title:"Kitchen oils", text:"", markers:[], outline: {
    interviewId:crypto.randomUUID(), sections:[{heading:"A",questionIds:[]},{heading:"B",questionIds:[]}] } };
  const beats=legacy.outline!.sections.map(s=>({...s,id:crypto.randomUUID()}));
  let draft=reviseOutline(legacy,beats,"Compare the oils",legacy.outline!.interviewId);
  const scripted=writeOutlineBody(draft,1,{lead:"Second.", sections:[{heading:"B",body:"Cited."}], markers:[{start:14,text:"Cited.",finding}]});
  draft=editDraft(scripted,scripted.text,[{start:0,length:6,attributes:{bold:true}}]);
  draft=writeOutlineBody(draft,0);
  expect(draft.text).toBe("## A\n\n\nSecond.\n\n## B\nCited.");
  expect(draft.text.slice(draft.markers[0].start)).toBe("Cited.");
  expect(draft.formatting?.[0]).toMatchObject({start:7,length:6});
  const [a,b]=draft.outline!.sections;
  const removed=reviseOutline(draft,[{...a,heading:"New opening"}],"",legacy.outline!.interviewId);
  expect(removed.outline!.removed).toEqual([b]);
  expect(removed.text).toBe(draft.text);
  expect(removed.text.slice(b.bodyStart!)).toMatch(/^Second\./);
  const restored=reviseOutline(removed,[b,a],"",legacy.outline!.interviewId);
  expect(restored.outline?.removed).toBeUndefined();
  expect(restored.markers).toEqual(draft.markers);
  expect(spaceSchema.parse({drafts:[restored],resources:[],messages:[]}).drafts[0].outline).toEqual(restored.outline);
  expect(()=>writeOutlineBody(restored,0)).toThrow();
});
