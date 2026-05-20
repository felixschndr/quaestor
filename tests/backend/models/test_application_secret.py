from source.backend.models.application_secret import ApplicationSecret


def test_application_secret_repr_contains_identifying_fields_but_not_value():
    application_secret = ApplicationSecret(id=5, name="fints_product_id", value="super_secret_value")

    representation = repr(application_secret)

    assert representation == "<ApplicationSecret(id=5, name=fints_product_id)>"
    assert "super_secret_value" not in representation
