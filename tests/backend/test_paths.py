from source.backend import paths


def test_derived_paths_live_inside_the_data_dir():
    assert paths.DATABASE_PATH == paths.DATA_DIR / "Quaestor.db"
    assert paths.BANK_DB_PATH == paths.DATA_DIR / "bank_info.pickle"
    assert paths.ENABLE_BANKING_ASPSPS_PATH == paths.DATA_DIR / "enable_banking_aspsps.json"
    assert paths.PLAYWRIGHT_BROWSERS_PATH == paths.DATA_DIR / "playwright"
