/// <reference types="mocha" />

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;

import { Config, IConfig } from "../core/Config";
import { days, getTime, hours, minutes, seconds, TimeUnit } from "../util/Time";
import { IVersionInfo, Trello } from "../util/Trello";

let configPassed = false;
let config: IConfig;

describe("[Utilities]", () => {
	it("[Config]", async () => {
		config = await new Config().get();
		expect(config).satisfy((cfg: IConfig) =>
			typeof cfg == "object" &&
			"commandPrefix" in cfg &&
			"apis" in cfg &&
			"plugins" in cfg,
		);
		configPassed = true;
	});

	describe("[Trello]", () => {
		describe("version lists", () => {
			let trello: Trello;
			before(() => {
				trello = new Trello();
				trello.setId(trello.getId());
				trello.config = config.apis.trello;
			});

			it("should get a list of all versions", async () => {
				if (!configPassed) {
					return;
				}

				await expect(trello.getVersions()).to.eventually.satisfy((versions: IVersionInfo[]) =>
					Array.isArray(versions) && versions.length > 5,
				);
			});

			it("should get the newest version", async () => {
				if (!configPassed) {
					return;
				}

				await expect(trello.getNewestVersion()).to.eventually.satisfy((version: IVersionInfo) => (
					typeof version === "object" &&
					typeof version.major === "number" &&
					typeof version.minor === "number" &&
					typeof version.patch === "number" &&
					typeof version.stage === "string"
				));
			});

		});
	});

	describe("[Time]", () => {
		describe("should return the correct value for", () => {
			it("seconds", () => {
				expect(seconds(1)).eq(1000);
			});
			it("minutes", () => {
				expect(minutes(1)).eq(60000);
			});
			it("hours", () => {
				expect(hours(1)).eq(3600000);
			});
			it("days", () => {
				expect(days(1)).eq(86400000);
			});
		});
		it("should work with string units", () => {
			expect(getTime(TimeUnit.Milliseconds, 1)).eq(1);
			expect(getTime(TimeUnit.Seconds, 1)).eq(1000);
			expect(getTime(TimeUnit.Minutes, 1)).eq(60000);
			expect(getTime(TimeUnit.Hours, 1)).eq(3600000);
			expect(getTime(TimeUnit.Days, 1)).eq(86400000);
		});
		it("should work for string times", () => {
			expect(getTime("1 milliseconds")).eq(1);
			expect(getTime("1 seconds")).eq(1000);
			expect(getTime("1 minutes")).eq(60000);
			expect(getTime("1 hours")).eq(3600000);
			expect(getTime("1 days")).eq(86400000);
		});
	});
});
