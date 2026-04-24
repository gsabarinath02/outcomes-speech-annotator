from app.core.security import get_password_hash, verify_password


def test_password_hashes_verify_and_support_existing_passlib_pbkdf2_hashes():
    password_hash = get_password_hash("Admin@123")
    assert verify_password("Admin@123", password_hash)
    assert not verify_password("wrong-password", password_hash)

    existing_hash = "$pbkdf2-sha256$29000$AqC09t57793b27s3Zuwdww$eWEpcLZoR4R0imLB1tI4Fx4zFh30WwhhVooqmhZcFC8"
    assert verify_password("Admin@123", existing_hash)


def test_login_and_me(client, seed_users):
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@test.com", "password": "Admin@123"},
    )
    assert login_response.status_code == 200
    payload = login_response.json()
    assert payload["user"]["role"] == "ADMIN"

    me_response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "admin@test.com"


def test_refresh_token_returns_new_session(client, seed_users):
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@test.com", "password": "Admin@123"},
    )
    assert login_response.status_code == 200

    refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": login_response.json()["refresh_token"]},
    )
    assert refresh_response.status_code == 200
    assert refresh_response.json()["user"]["email"] == "admin@test.com"
    assert refresh_response.json()["access_token"]


def test_failed_login_is_rate_limited(client, seed_users):
    for _ in range(5):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@test.com", "password": "wrong-password"},
        )
        assert response.status_code == 401

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@test.com", "password": "wrong-password"},
    )
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["message"] == "Too many failed login attempts. Try again later."
