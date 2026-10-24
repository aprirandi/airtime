"""The agents of a daily shift: Asker (steps 1-3) and Analyst (steps 4-7), checked by the Master.

The step modules in this package are shared: the Asker writes and asks the buyer questions,
the Analyst reads the answers, verifies every quote and counts. Step 7 (the owner summary)
stays with the Analyst until the Reporter agent exists.
"""

from __future__ import annotations

from airtime.agents.visibility.ask import step_ask_questions
from airtime.agents.visibility.compare import step_compare
from airtime.agents.visibility.questions import step_validate_questions, step_write_questions
from airtime.agents.visibility.summary import step_write_summary
from airtime.agents.visibility.verify import step_extract_mentions, step_verify_and_count
from airtime.core.agent import Agent, Flow, RunContext, Step, StepKind


class AskerAgent(Agent):
    """Writes the buyer questions and asks them to the AI assistants."""

    name = "asker"
    title = "Asker"

    def steps(self) -> list[Step]:
        def ask(ctx: RunContext):
            ctx.data["_scope"] = (ctx.ask_provider.name, ctx.ask_provider.channel)
            return step_ask_questions(ctx)

        return [
            Step(1, "write_questions", StepKind.AI, step_write_questions),
            Step(2, "validate_questions", StepKind.CODE, step_validate_questions),
            Step(3, "ask_questions", StepKind.CODE, ask),
        ]


class AnalystAgent(Agent):
    """Reads every answer, verifies each quote, counts, compares and writes the owner summary."""

    name = "analyst"
    title = "Analyst"

    def steps(self) -> list[Step]:
        return [
            Step(4, "extract_mentions", StepKind.AI, step_extract_mentions),
            Step(5, "verify_and_count", StepKind.CODE, step_verify_and_count),
            Step(6, "compare_previous", StepKind.CODE, step_compare),
            Step(7, "write_summary", StepKind.AI, step_write_summary),
        ]


class ImportAgent(Agent):
    """Stands in for the Asker when answers were pasted by hand from consumer apps."""

    name = "import"
    title = "Import"

    def __init__(self, load_answers, provider: str, channel: str):
        self.load_answers = load_answers
        self.scope = (provider, channel)

    def steps(self) -> list[Step]:
        def load(ctx: RunContext):
            ctx.data["_scope"] = self.scope
            return self.load_answers(ctx)

        return [Step(3, "import_answers", StepKind.CODE, load)]


def shift_flow() -> Flow:
    """The daily shift: Asker, Master check, Analyst, Master check."""
    from airtime.agents.visibility.master import CHECKS
    return Flow([AskerAgent(), AnalystAgent()], CHECKS)


def import_flow(load_answers, provider: str, channel: str) -> Flow:
    from airtime.agents.visibility.master import IMPORT_CHECKS
    return Flow([ImportAgent(load_answers, provider, channel), AnalystAgent()], IMPORT_CHECKS)
