from app.models import SessionCreateRequest


def test_team_count_defaults_to_eight_but_can_be_overridden():
    assert SessionCreateRequest(name='Hunt').team_count==8
    assert SessionCreateRequest(name='Hunt',team_count=3).team_count==3
