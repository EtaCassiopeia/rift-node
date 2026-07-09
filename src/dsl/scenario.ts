/**
 * FSM scenario builder: chains `when(state, stub) -> respond(response) -> goTo(next)` steps
 * into a flat list of wire {@link Stub}s carrying `scenarioName` / `required_scenario_state` /
 * `new_scenario_state`.
 *
 * A step is committed when the next `.when()` starts (or at `.build()`), so a terminal state
 * with no `.goTo()` is not lost. Calling `.respond()`/`.goTo()` with no open `.when()` throws
 * rather than silently dropping work.
 */

import type { Predicate, Stub, StubResponse } from '../model/index.js';
import type { ResponseBuilder } from './response.js';
import type { StubBuilder } from './stub.js';

interface OpenStep {
  state: string;
  stubBuilder: StubBuilder;
  response: StubResponse | undefined;
  next: string | undefined;
}

interface Step {
  state: string;
  next: string | undefined;
  predicates: Predicate[];
  responses: StubResponse[];
}

export class ScenarioBuilder {
  private readonly name: string;
  private readonly steps: Step[] = [];
  private open: OpenStep | undefined;
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
    const built = this.open.stubBuilder.build();
    this.steps.push({
      state: this.open.state,
      next: this.open.next,
      predicates: built.predicates ?? [],
      responses:
        this.open.response !== undefined ? [this.open.response] : (built.responses ?? []),
    });
    this.open = undefined;
  }

  when(state: string, stubBuilder: StubBuilder): this {
    this.commitOpen();
    this.open = { state, stubBuilder, response: undefined, next: undefined };
    return this;
  }

  respond(response: ResponseBuilder): this {
    if (this.open === undefined) {
      throw new Error('scenario.respond() called without a preceding .when()');
    }
    this.open.response = response.build();
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
