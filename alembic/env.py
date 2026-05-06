from logging.config import fileConfig

from alembic import context
from alembic.operations.ops import MigrateOperation, MigrationScript
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from source.db import engine
from source.models import Base
from sqlalchemy import MetaData

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata: MetaData = Base.metadata


def _describe_operation(op: MigrateOperation) -> str:
    name = type(op).__name__.lower().removesuffix("ops")
    parts = [name]
    column = getattr(op, "column_name", None)
    table = getattr(op, "table_name", None)
    if column:
        parts.append(column)
    if table:
        parts.append(table)
    return "_".join(parts)


def process_revision_directives(
    migration_context: MigrationContext,
    _revision: tuple[str, ...],
    directives: list[MigrationScript],
) -> None:
    if not directives:
        return
    script = directives[0]

    head = ScriptDirectory.from_config(migration_context.config).get_current_head()
    next_num = 1 if head is None else int(head) + 1
    script.rev_id = f"{next_num:04d}"

    if not script.message:
        operations: list[str] = []
        for upgrade_ops in script.upgrade_ops_list or []:
            operations.extend(_describe_operation(operation) for operation in upgrade_ops.ops)
        script.message = "__".join(operations) or "empty"


with engine.connect() as connection:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
        process_revision_directives=process_revision_directives,
    )
    with context.begin_transaction():
        context.run_migrations()
