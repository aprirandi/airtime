"""The Visibility agent: the 7 daily steps, each marked CODE or AI."""

from __future__ import annotations

from airtime.agents.visibility.ask import step_ask_questions
from airtime.agents.visibility.compare import step_compare
from airtime.agents.visibility.questions import step_validate_questions, step_write_questions
from airtime.agents.visibility.summary import step_write_summary
from airtime.agents.visibility.verify import step_extract_mentions, step_verify_and_count
from airtime.core.agent import Agent, RunContext, Step, StepKind


def _set_scope(ctx: RunContext) -> None:
    ctx.data["_scope"] = (ctx.ask_provider.name, ctx.ask_provider.channel)


class VisibilityAgent(Agent):
    """Ask AI assistants buyer questions daily and count how often our store is named."""

    name = "visibility"

    def steps(self) -> list[Step]:
        def ask(ctx):
            _set_scope(ctx)
            return step_ask_questions(ctx)

        return [
            Step(1, "write_questions", StepKind.AI, step_write_questions),
            Step(2, "validate_questions", StepKind.CODE, step_validate_questions),
            Step(3, "ask_questions", StepKind.CODE, ask),
            Step(4, "extract_mentions", StepKind.AI, step_extract_mentions),
            Step(5, "verify_and_count", StepKind.CODE, step_verify_and_count),
            Step(6, "compare_previous", StepKind.CODE, step_compare),
            Step(7, "write_summary", StepKind.AI, step_write_summary),
        ]


class ImportedAnswersAgent(Agent):
    """Steps 4-7 on answers pasted from consumer apps, so they are counted the same way.

    The importer stores the answers under this agent's run before steps 4-7 run.
    """

    name = "visibility_import"

    def __init__(self, load_answers, provider: str, channel: str):
        self.load_answers = load_answers
        self.scope = (provider, channel)

    def steps(self) -> list[Step]:
        def load(ctx):
            ctx.data["_scope"] = self.scope
            return self.load_answers(ctx)

        return [
            Step(3, "import_answers", StepKind.CODE, load),
            Step(4, "extract_mentions", StepKind.AI, step_extract_mentions),
            Step(5, "verify_and_count", StepKind.CODE, step_verify_and_count),
            Step(6, "compare_previous", StepKind.CODE, step_compare),
            Step(7, "write_summary", StepKind.AI, step_write_summary),
        ]
