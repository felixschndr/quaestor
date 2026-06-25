import pytest
from source.backend.bank_handlers.bank_logos import logo_exists, logo_slug


@pytest.mark.parametrize(
    argnames="name, expected",
    argvalues=[
        # Families: many differently-named banks share one slug via keyword.
        ("Stadtsparkasse München", "sparkasse"),
        ("Berliner Sparkasse", "sparkasse"),
        ("Volksbank Mittelhessen", "volksbank"),
        ("Volks- und Raiffeisenbank", "volksbank"),
        ("VR Bank Mecklenburg", "volksbank"),  # both VR spellings normalise to the same keyword
        ("VR-Bank Altenburger Land", "volksbank"),
        ("VR SüdBank", "volksbank"),
        ("Genossenschaftsbank München", "volksbank"),
        ("Sparda-Bank Berlin", "sparda"),
        ("Commerzbank Köln", "commerzbank"),
        ("UniCredit Bank - HypoVereinsbank", "hypovereinsbank"),
        # comdirect must win over commerzbank (it is ordered first).
        ("Commerzbank - GF comdirect", "comdirect"),
        # Everything else derives a URL-safe slug from its own name.
        ("ING-DiBa", "ing-diba"),
        ("Deutsche Kreditbank Berlin", "deutsche-kreditbank-berlin"),
        ("Deutsche Bank Fil Berlin", "deutsche-bank-fil-berlin"),
        ("TARGOBANK", "targobank"),
    ],
)
def test_logo_slug_resolves_name_to_slug(name: str, expected: str):
    assert logo_slug(name) == expected


def test_logo_exists_only_for_shipped_logos():
    # sparkasse.png is shipped; a derived slug for a bank without a logo is not.
    assert logo_exists("sparkasse") is True
    assert logo_exists("deutsche-bank-fil-berlin") is False
