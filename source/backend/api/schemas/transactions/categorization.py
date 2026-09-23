import datetime

from pydantic import BaseModel, ConfigDict

from source.backend.models.transactions.transaction_category import CategoryGroup


class CategoryRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pattern: str
    category: str
    created_at: datetime.datetime


class DefaultMatcherRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    pattern: str
    category: str
    disabled: bool


class CategorizationRead(BaseModel):
    rules: list[CategoryRuleRead]
    default_matchers: list[DefaultMatcherRead]
    recategorized: int = 0


class CategoryRuleIn(BaseModel):
    pattern: str
    category: str


class DefaultMatcherToggle(BaseModel):
    pattern: str
    disabled: bool


class CustomCategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    group: CategoryGroup
    name: str
    owned: bool


class CustomCategoriesRead(BaseModel):
    custom_categories: list[CustomCategoryRead]
    recategorized: int = 0


class CustomCategoryIn(BaseModel):
    group: CategoryGroup
    name: str
