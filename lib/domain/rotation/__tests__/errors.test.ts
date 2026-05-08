/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — sanity tests for the rotation typed-error classes.
 * The wire-mapping behaviour is covered by `mapApiDomainError`'s tests;
 * these only assert the data each class carries.
 */
import { describe, it, expect } from "vitest";

import {
  BlankNameError,
  InvalidDateError,
  InvalidOrderError,
  InvalidPlannedDaysError,
  InvalidStatusError,
  MissingFieldError,
  MissingMobIdError,
  MobAlreadyInCampError,
  PlanNotFoundError,
  ROTATION_PLAN_STATUSES,
  StepAlreadyExecutedError,
  StepNotFoundError,
  PLAN_NOT_FOUND,
  STEP_NOT_FOUND,
  STEP_ALREADY_EXECUTED,
  INVALID_STATUS,
  BLANK_NAME,
  INVALID_DATE,
  MISSING_FIELD,
  INVALID_PLANNED_DAYS,
  INVALID_ORDER,
  MISSING_MOB_ID,
  MOB_ALREADY_IN_CAMP,
} from "@/lib/domain/rotation/errors";

describe("rotation errors", () => {
  it("PlanNotFoundError carries planId + code", () => {
    const err = new PlanNotFoundError("pln-1");
    expect(err.code).toBe(PLAN_NOT_FOUND);
    expect(err.planId).toBe("pln-1");
    expect(err.name).toBe("PlanNotFoundError");
  });

  it("StepNotFoundError carries stepId + code", () => {
    const err = new StepNotFoundError("stp-1");
    expect(err.code).toBe(STEP_NOT_FOUND);
    expect(err.stepId).toBe("stp-1");
  });

  it("StepAlreadyExecutedError carries currentStatus + code", () => {
    const err = new StepAlreadyExecutedError("executed");
    expect(err.code).toBe(STEP_ALREADY_EXECUTED);
    expect(err.currentStatus).toBe("executed");
  });

  it("InvalidStatusError carries field + allowed list", () => {
    const err = new InvalidStatusError();
    expect(err.code).toBe(INVALID_STATUS);
    expect(err.field).toBe("status");
    expect(err.allowed).toEqual(ROTATION_PLAN_STATUSES);
  });

  it("BlankNameError code", () => {
    const err = new BlankNameError();
    expect(err.code).toBe(BLANK_NAME);
  });

  it("InvalidDateError carries field", () => {
    const err = new InvalidDateError("startDate");
    expect(err.code).toBe(INVALID_DATE);
    expect(err.field).toBe("startDate");
    const err2 = new InvalidDateError("plannedStart");
    expect(err2.field).toBe("plannedStart");
  });

  it("MissingFieldError carries field", () => {
    const err = new MissingFieldError("name");
    expect(err.code).toBe(MISSING_FIELD);
    expect(err.field).toBe("name");
  });

  it("InvalidPlannedDaysError code", () => {
    expect(new InvalidPlannedDaysError().code).toBe(INVALID_PLANNED_DAYS);
  });

  it("InvalidOrderError carries expected + actual", () => {
    const err = new InvalidOrderError(3, 2);
    expect(err.code).toBe(INVALID_ORDER);
    expect(err.expected).toBe(3);
    expect(err.actual).toBe(2);
  });

  it("MissingMobIdError code", () => {
    expect(new MissingMobIdError().code).toBe(MISSING_MOB_ID);
  });

  it("MobAlreadyInCampError code", () => {
    expect(new MobAlreadyInCampError().code).toBe(MOB_ALREADY_IN_CAMP);
  });
});
