"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
const Trello_1 = require("../util/Trello");
describe("trello", async () => {
    describe("version lists", () => {
        it("should get a list of all versions", async () => {
            await expect(Trello_1.trello.getVersions()).to.eventually.satisfy((versions) => Array.isArray(versions) && versions.length > 5);
        });
        it("should get the newest version", async () => {
            await expect(Trello_1.trello.getNewestVersion()).to.eventually.satisfy((version) => (typeof version === "object" &&
                typeof version.str === "string" &&
                typeof version.major === "number" &&
                typeof version.minor === "number" &&
                typeof version.patch === "number" &&
                typeof version.stage === "string" &&
                typeof version.name === "string"));
        });
    });
});
