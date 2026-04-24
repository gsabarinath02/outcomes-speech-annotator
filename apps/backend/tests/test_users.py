def test_admin_can_list_and_create_users(client, auth_headers):
    list_response = client.get("/api/v1/users", headers=auth_headers["admin"])
    assert list_response.status_code == 200
    assert len(list_response.json()["items"]) >= 3

    create_response = client.post(
        "/api/v1/users",
        headers=auth_headers["admin"],
        json={
            "email": "new.annotator@test.com",
            "full_name": "New Annotator",
            "role": "ANNOTATOR",
            "password": "StrongPass@123",
            "is_active": True,
        },
    )
    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["email"] == "new.annotator@test.com"
    assert payload["role"] == "ANNOTATOR"
    assert payload["is_active"] is True


def test_non_admin_cannot_manage_users(client, auth_headers):
    denied_list = client.get("/api/v1/users", headers=auth_headers["annotator"])
    assert denied_list.status_code == 403

    denied_create = client.post(
        "/api/v1/users",
        headers=auth_headers["reviewer"],
        json={
            "email": "blocked.user@test.com",
            "full_name": "Blocked User",
            "role": "ANNOTATOR",
            "password": "StrongPass@123",
        },
    )
    assert denied_create.status_code == 403
