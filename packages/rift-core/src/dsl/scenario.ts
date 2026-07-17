/**
 * FSM scenario builder: chains `when(state, stub) -> respond(response) -> goTo(next)` steps
 * into a flat list of wire {@link Stub}s carrying `scenarioName` / `required_scenario_state` /
 * `new_scenario_state`.
 *
 * `when()` builds and snapshots the stub's predicates immediately — mutating the passed-in
 * {@link AnyStubBuilder} afterward (e.g. calling `.when()` on it again) does not change the
 * committed step. A step is committed to the step list when the next `.when()` starts (or at
 * `.build()`), so a terminal state with no `.goTo()` is not lost. Calling `.respond()`/`.goTo()`
 * with no open `.when()` throws rather than silently dropping work.
 */

import type { Predicate, Stub, StubResponse } from '../model/index.js';
import { ResponseBuilder } from './response.js';
import type { AnyStubBuilder } from './stub.js';

interface Step {
  state: string;
  next: string | undefined;
  predicates: Predicate[];
  responses: StubResponse[];
}

export class ScenarioBuilder {
  private readonly name: string;
  private readonly steps: Step[] = [];
  private open: Step | undefined;
  private initialState: string | undefined;

  constructor(name: string) {
    this.name = name;
  }

  /** Documents (and, at build, checks) the FSM's initial state — the first step's state. */
  startingAt(state: string): this {
    this.initialState = state;
    return this;
  }

  private commitOpen(): void {
    if (this.open === undefined) return;
    this.steps.push(this.open);
    this.open = undefined;
  }

  when(state: string, stubBuilder: AnyStubBuilder): this {
    this.commitOpen();
    const built = stubBuilder.build();
    this.open = {
      state,
      next: undefined,
      predicates: built.predicates ?? [],
      responses: built.responses ?? [],
    };
    return this;
  }

  /** Sets the response cycle for the open step. Multiple responses cycle within the state. */
  respond(...responses: Array<ResponseBuilder | StubResponse>): this {
    if (this.open === undefined) {
      throw new Error('scenario.respond() called without a preceding .when()');
    }
    this.open.responses = responses.map((r) => (r instanceof ResponseBuilder ? r.build() : r));
    return this;
  }

  goTo(next: string): this {
    if (this.open === undefined) {
      throw new Error('scenario.goTo() called without a preceding .when()');
    }
    this.open.next = next;
    return this;
  }

  build(): Stub[] {
    this.commitOpen();
    if (
      this.initialState !== undefined &&
      this.steps.length > 0 &&
      this.steps[0]!.state !== this.initialState
    ) {
      throw new Error(
        `scenario.startingAt(${this.initialState}) does not match the first .when() state (${this.steps[0]!.state})`
      );
    }
    return this.steps.map((step) => {
      const stub: Stub = {
        scenarioName: this.name,
        required_scenario_state: step.state,
        predicates: step.predicates,
        responses: step.responses,
      };
      if (step.next !== undefined) stub.new_scenario_state = step.next;
      return stub;
    });
  }
}

export function scenario(name: string): ScenarioBuilder {
  return new ScenarioBuilder(name);
}
