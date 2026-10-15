import { describe, it, expect } from "vitest";

describe("Testing environment", () => {
    it("should execute a basic automated test", () => {
        const usedUnits = 100;
        const monthlyAllowance = 1000;

        const remainingUnits = monthlyAllowance - usedUnits;

        expect(remainingUnits).toBe(900);
    });
});