"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var Lint = require("tslint");
var tsutils_1 = require("tsutils");
var ts = require("typescript");
var BlankLineKind;
(function (BlankLineKind) {
    BlankLineKind[BlankLineKind["Always"] = 0] = "Always";
    BlankLineKind[BlankLineKind["Never"] = 1] = "Never";
})(BlankLineKind || (BlankLineKind = {}));
var StatementKind;
(function (StatementKind) {
    StatementKind[StatementKind["Any"] = 0] = "Any";
    StatementKind[StatementKind["Variable"] = 1] = "Variable";
    StatementKind[StatementKind["Empty"] = 2] = "Empty";
    StatementKind[StatementKind["Expression"] = 3] = "Expression";
    StatementKind[StatementKind["If"] = 4] = "If";
    StatementKind[StatementKind["Else"] = 5] = "Else";
    StatementKind[StatementKind["ElseIf"] = 6] = "ElseIf";
    StatementKind[StatementKind["Do"] = 7] = "Do";
    StatementKind[StatementKind["While"] = 8] = "While";
    StatementKind[StatementKind["For"] = 9] = "For";
    StatementKind[StatementKind["Forin"] = 10] = "Forin";
    StatementKind[StatementKind["Forof"] = 11] = "Forof";
    StatementKind[StatementKind["Continue"] = 12] = "Continue";
    StatementKind[StatementKind["Break"] = 13] = "Break";
    StatementKind[StatementKind["Return"] = 14] = "Return";
    StatementKind[StatementKind["With"] = 15] = "With";
    StatementKind[StatementKind["Switch"] = 16] = "Switch";
    StatementKind[StatementKind["Labeled"] = 17] = "Labeled";
    StatementKind[StatementKind["Throw"] = 18] = "Throw";
    StatementKind[StatementKind["Try"] = 19] = "Try";
    StatementKind[StatementKind["Debugger"] = 20] = "Debugger";
})(StatementKind || (StatementKind = {}));
var blankLineKinds = [];
for (var blankLineKind in BlankLineKind) {
    if (typeof (blankLineKind) === "string") {
        blankLineKinds.push(blankLineKind.toLowerCase());
    }
}
var statementKindAny = "*";
var allStatementKinds = [statementKindAny];
for (var statementKind in StatementKind) {
    if (typeof (statementKind) === "string" && statementKind !== "Any") {
        allStatementKinds.push(statementKind.toLowerCase());
    }
}
function parseOptions(rawOptions) {
    var options = {
        paddings: [],
    };
    for (var _i = 0, rawOptions_1 = rawOptions; _i < rawOptions_1.length; _i++) {
        var op = rawOptions_1[_i];
        var prevKinds = [];
        var nextKinds = [];
        var blankLineKind = void 0;
        var prevs = Array.isArray(op.prev) ? op.prev : [op.prev];
        for (var _a = 0, prevs_1 = prevs; _a < prevs_1.length; _a++) {
            var prev = prevs_1[_a];
            for (var kind in StatementKind) {
                if (typeof (kind) === "string" &&
                    (kind.toLowerCase() === prev.toLowerCase() ||
                        (kind.toLowerCase() === "any" && prev === statementKindAny))) {
                    prevKinds.push(StatementKind[kind]);
                    break;
                }
            }
        }
        var nexts = Array.isArray(op.next) ? op.next : [op.next];
        for (var _b = 0, nexts_1 = nexts; _b < nexts_1.length; _b++) {
            var next = nexts_1[_b];
            for (var kind in StatementKind) {
                if (typeof (kind) === "string" &&
                    (kind.toLowerCase() === next.toLowerCase() ||
                        (kind.toLowerCase() === "any" && next === statementKindAny))) {
                    nextKinds.push(StatementKind[kind]);
                    break;
                }
            }
        }
        var blankLine = op.blankLine;
        for (var kind in BlankLineKind) {
            if (typeof (kind) === "string" && kind.toLowerCase() === blankLine) {
                blankLineKind = BlankLineKind[kind];
                break;
            }
        }
        if (blankLineKind === undefined) {
            throw new Error("Invalid value '" + blankLine + "' for blankLine");
        }
        options.paddings.push({
            blankLine: blankLineKind,
            prev: prevKinds,
            next: nextKinds,
        });
    }
    return options;
}
var Rule = (function (_super) {
    __extends(Rule, _super);
    function Rule() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    Rule.prototype.apply = function (sourceFile) {
        var options;
        try {
            options = parseOptions(this.ruleArguments);
        }
        catch (e) {
            return [];
        }
        return this.applyWithWalker(new Walker(sourceFile, this.ruleName, options));
    };
    Rule.metadata = {
        ruleName: "padding-line-between-statements",
        description: "Enforces padding between statements.",
        rationale: "Consistent padding between statements can make methods easier to read and maintain.",
        optionsDescription: "",
        options: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    blankLine: {
                        type: "string",
                        enum: blankLineKinds,
                    },
                    prev: {
                        oneOf: [
                            {
                                type: "string",
                                enum: allStatementKinds,
                            },
                            {
                                type: "array",
                                items: {
                                    type: "string",
                                    enum: allStatementKinds,
                                },
                            },
                        ],
                    },
                    next: {
                        oneOf: [
                            {
                                type: "string",
                                enum: allStatementKinds,
                            },
                            {
                                type: "array",
                                items: {
                                    type: "string",
                                    enum: allStatementKinds,
                                },
                            },
                        ],
                    },
                },
            },
            minLength: 0,
        },
        optionExamples: [
            [
                true,
                {
                    blankLine: "always",
                    prev: "if",
                    next: "*",
                },
            ],
        ],
        hasFix: true,
        type: "typescript",
        typescriptOnly: false,
    };
    return Rule;
}(Lint.Rules.AbstractRule));
exports.Rule = Rule;
var Walker = (function (_super) {
    __extends(Walker, _super);
    function Walker(sourceFile, ruleName, options) {
        var _this = _super.call(this, sourceFile, ruleName, options) || this;
        _this.checkStatements = {};
        for (var _i = 0, _a = options.paddings; _i < _a.length; _i++) {
            var paddingOption = _a[_i];
            var paddingRule = __assign({}, paddingOption, { prevSyntaxKind: _this.getSyntaxKinds(paddingOption.prev), nextSyntaxKind: _this.getSyntaxKinds(paddingOption.next) });
            _this.addCheckStatements(paddingRule.prevSyntaxKind, paddingRule);
            _this.addCheckStatements(paddingRule.nextSyntaxKind, paddingRule);
        }
        return _this;
    }
    Walker.prototype.walk = function (sourceFile) {
        var _this = this;
        var cb = function (node) {
            _this.visitNode(node);
            return ts.forEachChild(node, cb);
        };
        return ts.forEachChild(sourceFile, cb);
    };
    Walker.prototype.visitNode = function (node) {
        var checks = this.checkStatements[node.kind];
        if (checks !== undefined) {
            checks = checks.filter(function (opt) { return opt.prev.indexOf(StatementKind.Any) !== -1 || opt.prevSyntaxKind.indexOf(node.kind) !== -1; });
            if (checks.length > 0) {
                this.visitStatement(node, checks);
            }
            if (node.kind === ts.SyntaxKind.IfStatement) {
                var ifStatement = node;
                var thenStatement = ifStatement.thenStatement;
                var elseStatement = ifStatement.elseStatement;
                if (thenStatement !== undefined && thenStatement.kind === ts.SyntaxKind.Block && elseStatement !== undefined) {
                    var elseStatementKind_1 = elseStatement.kind === ts.SyntaxKind.IfStatement ? StatementKind.ElseIf : StatementKind.Else;
                    checks = checks.filter(function (opt) { return opt.prev.indexOf(StatementKind.Any) !== -1 || opt.prev.indexOf(elseStatementKind_1) !== -1; });
                    if (checks.length > 0) {
                        var thenBlock = thenStatement;
                        var lastThenBlockStatement = thenBlock.statements[thenBlock.statements.length - 1];
                        if (lastThenBlockStatement !== undefined) {
                            this.visitStatement(lastThenBlockStatement, checks, elseStatement, elseStatementKind_1, StatementKind.If);
                        }
                    }
                }
            }
        }
    };
    Walker.prototype.visitStatement = function (statement, paddingRules, nextStatement, nextStatementKind, statementKind) {
        if (nextStatement === void 0) { nextStatement = tsutils_1.getNextStatement(statement); }
        if (nextStatement === undefined) {
            return;
        }
        paddingRules = paddingRules.filter(function (opt) {
            return opt.next.indexOf(StatementKind.Any) !== -1 ||
                (nextStatementKind !== undefined && opt.next.indexOf(nextStatementKind) !== -1) ||
                (nextStatementKind === undefined && opt.nextSyntaxKind.indexOf(nextStatement.kind) !== -1);
        });
        if (paddingRules.length === 0) {
            return;
        }
        else {
        }
        var statementEnd = statement.getEnd();
        var statementLine = ts.getLineAndCharacterOfPosition(this.sourceFile, statementEnd).line;
        var nextStatementStart = nextStatement.getStart(this.sourceFile);
        var nextStatementLine = ts.getLineAndCharacterOfPosition(this.sourceFile, nextStatementStart).line;
        var hasPadding = nextStatementLine - statementLine > 1;
        paddingRules = paddingRules.filter(function (opt) {
            switch (opt.blankLine) {
                case BlankLineKind.Always:
                    return !hasPadding;
                case BlankLineKind.Never:
                    return hasPadding;
                default:
                    return false;
            }
        });
        if (paddingRules.length > 0) {
            var fix = void 0;
            var paddingMessage = "Invalid";
            var blankLine_1 = paddingRules[0].blankLine;
            var sameBlankLine = paddingRules.every(function (opt) { return opt.blankLine === blankLine_1; });
            if (sameBlankLine) {
                var lineEnding = void 0;
                var lines = this.sourceFile.getLineStarts();
                if (lines.length > 1) {
                    lineEnding = this.sourceFile.text[lines[1] - 2] === "\r" ? "\r\n" : "\n";
                }
                if (blankLine_1 === BlankLineKind.Always) {
                    paddingMessage = "Expected";
                    if (lineEnding !== undefined) {
                        fix = Lint.Replacement.appendText(statementEnd, lineEnding);
                    }
                }
                else {
                    paddingMessage = "Unexpected";
                    if (lineEnding !== undefined) {
                        var lineEnd = lines[nextStatementLine - 1] - 1;
                        fix = Lint.Replacement.deleteText(lineEnd, lineEnding.length);
                    }
                }
            }
            var statementName = statementKind !== undefined ? StatementKind[statementKind] : ts.SyntaxKind[statement.kind];
            this.addFailure(statementEnd, statementEnd, paddingMessage + " padding after " + statementName, fix);
        }
    };
    Walker.prototype.addCheckStatements = function (syntaxKinds, paddingRule) {
        for (var _i = 0, syntaxKinds_1 = syntaxKinds; _i < syntaxKinds_1.length; _i++) {
            var syntaxKind = syntaxKinds_1[_i];
            this.addCheckStatement(syntaxKind, paddingRule);
        }
    };
    Walker.prototype.addCheckStatement = function (syntaxKind, paddingRule) {
        if (!this.checkStatements[syntaxKind]) {
            this.checkStatements[syntaxKind] = [];
        }
        this.checkStatements[syntaxKind].push(paddingRule);
    };
    Walker.prototype.getSyntaxKinds = function (statementKinds) {
        var syntaxKinds = [];
        for (var _i = 0, statementKinds_1 = statementKinds; _i < statementKinds_1.length; _i++) {
            var statementKind = statementKinds_1[_i];
            var syntaxKind = this.getSyntaxKind(statementKind);
            if (syntaxKind) {
                syntaxKinds.push(syntaxKind);
            }
        }
        return syntaxKinds;
    };
    Walker.prototype.getSyntaxKind = function (statementKind) {
        switch (statementKind) {
            case StatementKind.Variable:
                return ts.SyntaxKind.VariableStatement;
            case StatementKind.Empty:
                return ts.SyntaxKind.EmptyStatement;
            case StatementKind.Expression:
                return ts.SyntaxKind.ExpressionStatement;
            case StatementKind.If:
            case StatementKind.Else:
            case StatementKind.ElseIf:
                return ts.SyntaxKind.IfStatement;
            case StatementKind.Do:
                return ts.SyntaxKind.DoStatement;
            case StatementKind.While:
                return ts.SyntaxKind.WhileStatement;
            case StatementKind.For:
                return ts.SyntaxKind.ForStatement;
            case StatementKind.Forin:
                return ts.SyntaxKind.ForInStatement;
            case StatementKind.Forof:
                return ts.SyntaxKind.ForOfStatement;
            case StatementKind.Continue:
                return ts.SyntaxKind.ContinueStatement;
            case StatementKind.Break:
                return ts.SyntaxKind.BreakStatement;
            case StatementKind.Return:
                return ts.SyntaxKind.ReturnStatement;
            case StatementKind.With:
                return ts.SyntaxKind.WithStatement;
            case StatementKind.Switch:
                return ts.SyntaxKind.SwitchStatement;
            case StatementKind.Labeled:
                return ts.SyntaxKind.LabeledStatement;
            case StatementKind.Throw:
                return ts.SyntaxKind.ThrowStatement;
            case StatementKind.Try:
                return ts.SyntaxKind.TryStatement;
            case StatementKind.Debugger:
                return ts.SyntaxKind.DebuggerStatement;
            default:
                return undefined;
        }
    };
    return Walker;
}(Lint.AbstractWalker));
//# sourceMappingURL=paddingLineBetweenStatementsRule.js.map