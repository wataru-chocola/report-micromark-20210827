import {
  Construct,
  Extension,
  State,
  Code,
  Event,
  Effects,
  TokenizeContext,
} from "micromark-util-types";
import { codes } from "micromark-util-symbol/codes";
import { types } from "micromark-util-symbol/types";
import { factorySpace } from "micromark-factory-space";
import { constants } from "micromark-util-symbol/constants.js";
import { markdownSpace } from "micromark-util-character";
import { blankLine } from "micromark-core-commonmark/dev/lib/blank-line";
import { tokenTypes } from "./types";
import assert from "assert";

interface TokenizeContextWithDefState extends TokenizeContext {
  containerState?: {
    _closeFlow?: boolean;
    size?: number;
    type?: string;
  } & Record<string, unknown>;
}

const defListConstruct: Construct = {
  name: "defList",
  tokenize: tokenizeDefListStart,
  continuation: {
    tokenize: tokenizeDefListContinuation,
  },
  resolveTo: resolveToDefinitionTerm,
  exit: tokenizeDefListEnd,
};

const defListDescriptionPrefixWhitespaceConstruct: Construct = {
  tokenize: tokenizeDefListDescriptionPrefixWhitespace,
  partial: true,
};

const indentConstruct = { tokenize: tokenizeIndent, partial: true };

export const defList: Extension = {
  document: { [codes.colon]: defListConstruct, null: [] },
};

function inspectEvents(events: Event[] | undefined): void {
  if (events == null) {
    return;
  }
  events.forEach((x) => {
    let content = "";
    try {
      content = x[2].sliceSerialize(x[1], true);
    } catch (e) {
      content = "<maybe incomplete token>";
    }
    console.log([x[0], x[1].type, content]);
  });
}

function resolveToDefinitionTerm(
  events: Event[],
  context: TokenizeContext
): Event[] {
  console.log("+ run resolverTo");

  let index = events.length;
  let defList_start: number | undefined;
  let flowStart: number | undefined;
  let flowEnd: number | undefined;
  while (index--) {
    if (defList_start != null) {
      if (
        events[index][0] === "enter" &&
        events[index][1].type === types.chunkFlow
      ) {
        flowStart = index;
        break;
      }
      if (
        events[index][0] === "exit" &&
        events[index][1].type === types.chunkFlow
      ) {
        flowEnd = index;
      }
    }
    if (
      events[index][0] === "enter" &&
      events[index][1].type === tokenTypes.defList
    ) {
      defList_start = index;
    }
  }
  assert(flowStart !== undefined, "expected a chunkFlow enter");
  assert(flowEnd !== undefined, "expected a chunkFlow exit");

  const termToken = {
    type: tokenTypes.defListTerm,
    start: Object.assign({}, events[flowEnd][1].start),
    end: Object.assign({}, events[flowEnd][1].end),
  };

  events.splice(flowEnd, 0, ["exit", termToken, context]);
  events.splice(flowStart, 0, ["enter", termToken, context]);

  return events;
}

let runCount = 0;

function tokenizeDefListStart(
  this: TokenizeContextWithDefState,
  effects: Effects,
  ok: State,
  nok: State
): State {
  console.log(`+ initialize tokenizer (runCount: ${++runCount})`);
  console.log(`+ previous events`);
  inspectEvents(this.events);

  const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
  if (self.containerState == null) {
    self.containerState = {};
  }

  if (self.containerState!.type == null) {
    if (self.interrupt) {
      effects.enter(tokenTypes.defList, { _container: true });
      self.containerState!.type = tokenTypes.defList;
    } else {
      return nok;
    }
  }

  return start;

  function start(code: Code): State | void {
    if (code !== codes.colon) {
      return nok(code);
    }

    effects.enter(tokenTypes.defListDescription);
    effects.enter(tokenTypes.defListDescriptionPrefix);
    effects.enter(tokenTypes.defListDescriptionMarker);
    effects.consume(code);
    effects.exit(tokenTypes.defListDescriptionMarker);

    return effects.attempt(
      defListDescriptionPrefixWhitespaceConstruct,
      prefixEnd,
      otherPrefix
    );
  }

  function otherPrefix(code: Code): State | void {
    if (markdownSpace(code)) {
      effects.enter(tokenTypes.defListDescriptionPrefixWhitespace);
      effects.consume(code);
      effects.exit(tokenTypes.defListDescriptionPrefixWhitespace);
      return prefixEnd;
    }
    return nok(code);
  }

  function prefixEnd(code: Code): State | void {
    self.containerState!.size = self.sliceSerialize(
      effects.exit(tokenTypes.defListDescriptionPrefix),
      true
    ).length;

    return ok(code);
  }
}

function tokenizeDefListContinuation(
  this: TokenizeContextWithDefState,
  effects: Effects,
  ok: State,
  nok: State
): State {
  const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
  self.containerState!._closeFlow = undefined;
  return effects.check(blankLine, notInCurrentItem, notBlank);

  function notBlank(code: Code): State | void {
    return effects.attempt(indentConstruct, ok, notInCurrentItem)(code);
  }

  function notInCurrentItem(code: Code): State | void {
    self.containerState!._closeFlow = true;
    self.interrupt = undefined;
    effects.exit(tokenTypes.defListDescription);

    return factorySpace(
      effects,
      effects.attempt(defListConstruct, ok, nok),
      types.linePrefix,
      self.parser.constructs.disable.null.includes("codeIndented")
        ? undefined
        : constants.tabSize
    )(code);
  }
}

function tokenizeIndent(
  this: TokenizeContextWithDefState,
  effects: Effects,
  ok: State,
  nok: State
): State {
  const self = this; // eslint-disable-line @typescript-eslint/no-this-alias

  return factorySpace(
    effects,
    afterPrefix,
    tokenTypes.defListDescriptionIndent,
    self.containerState!.size! + 1
  );

  function afterPrefix(code: Code): State | void {
    const tail = self.events[self.events.length - 1];
    return tail &&
      tail[1].type === tokenTypes.defListDescriptionIndent &&
      tail[2].sliceSerialize(tail[1], true).length ===
        self.containerState!.size!
      ? ok(code)
      : nok(code);
  }
}

function tokenizeDefListDescriptionPrefixWhitespace(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State
): State {
  const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
  return factorySpace(
    effects,
    afterPrefix,
    tokenTypes.defListDescriptionPrefixWhitespace,
    self.parser.constructs.disable.null.includes("codeIndented")
      ? undefined
      : constants.tabSize + 1
  );

  function afterPrefix(code: Code): State | void {
    const tail = self.events[self.events.length - 1];

    return !markdownSpace(code) &&
      tail &&
      tail[1].type === tokenTypes.defListDescriptionPrefixWhitespace
      ? ok(code)
      : nok(code);
  }
}

function tokenizeDefListEnd(this: TokenizeContext, effects: Effects): void {
  effects.exit(tokenTypes.defListDescription);
  effects.exit(tokenTypes.defList);
}
