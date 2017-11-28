/// <reference types="mocha" />

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;

import { IVersionInfo, trello } from "../util/Trello";

describe("trello", async () => {
	describe("version lists", () => {
		it("should get a list of all versions", async () => {
			await expect(trello.getVersions()).to.eventually.satisfy((versions: IVersionInfo[]) => Array.isArray(versions) && versions.length > 5);
		});

		it("should get the newest version", async () => {
			await expect(trello.getNewestVersion()).to.eventually.satisfy((version: IVersionInfo) => (
				typeof version === "object" &&
				typeof version.str === "string" &&
				typeof version.major === "number" &&
				typeof version.minor === "number" &&
				typeof version.patch === "number" &&
				typeof version.stage === "string" &&
				typeof version.name === "string"
			));
		});

	});
});
