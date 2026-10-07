"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

interface AdminUsersResponse {
  users: User[];
  pagination: PaginationInfo;
}

export default function AdminPanel() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editFormData, setEditFormData] = useState({
    username: "",
    displayName: "",
    password: "",
    isAdmin: false,
  });

  useEffect(() => {
    fetchUsers();
  }, [page, searchTerm]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: "20",
        search: searchTerm,
      });

      const response = await fetch(`/api/admin/users?${params}`);

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      if (response.status === 403) {
        setError("Você não tem permissão para acessar esta página.");
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Erro ao carregar usuários");
      }

      const data: AdminUsersResponse = await response.json();
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar usuários");
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (user: User) => {
    setEditingUser(user);
    setEditFormData({
      username: user.username || "",
      displayName: user.displayName,
      password: "",
      isAdmin: user.isAdmin,
    });
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    try {
      const payload: any = {};
      if (editFormData.username !== editingUser.username) {
        payload.username = editFormData.username;
      }
      if (editFormData.displayName !== editingUser.displayName) {
        payload.displayName = editFormData.displayName;
      }
      if (editFormData.password) {
        payload.password = editFormData.password;
      }
      if (editFormData.isAdmin !== editingUser.isAdmin) {
        payload.isAdmin = editFormData.isAdmin;
      }

      if (Object.keys(payload).length === 0) {
        setEditingUser(null);
        return;
      }

      const response = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Erro ao atualizar usuário");
      }

      const updatedUser = await response.json();
      setUsers(users.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
      setEditingUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar usuário");
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`Tem certeza que deseja deletar o usuário "${username}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Erro ao deletar usuário");
      }

      setUsers(users.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao deletar usuário");
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Painel Administrativo</h1>

        {error && (
          <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex gap-4 mb-6">
            <input
              type="text"
              placeholder="Buscar por nome de usuário ou nome de exibição..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="flex-1 bg-gray-700 text-white px-4 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {loading ? (
            <div className="text-center py-8">Carregando usuários...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              Nenhum usuário encontrado
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-3 px-4">Nome de Usuário</th>
                      <th className="text-left py-3 px-4">Nome de Exibição</th>
                      <th className="text-left py-3 px-4">Admin</th>
                      <th className="text-left py-3 px-4">Criado em</th>
                      <th className="text-left py-3 px-4">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-gray-700 hover:bg-gray-700 transition"
                      >
                        <td className="py-3 px-4">{user.username || "-"}</td>
                        <td className="py-3 px-4">{user.displayName}</td>
                        <td className="py-3 px-4">
                          {user.isAdmin ? (
                            <span className="bg-red-600 px-2 py-1 rounded text-xs">
                              Sim
                            </span>
                          ) : (
                            <span className="text-gray-400">Não</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {new Date(user.createdAt).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleEditClick(user)}
                            className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm mr-2"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteUser(user.id, user.username || user.displayName)
                            }
                            className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm"
                          >
                            Deletar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pagination && pagination.pages > 1 && (
                <div className="flex justify-center gap-2 mt-6">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-4 py-2 rounded"
                  >
                    Anterior
                  </button>
                  <span className="px-4 py-2">
                    Página {pagination.page} de {pagination.pages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(pagination.pages, page + 1))}
                    disabled={page === pagination.pages}
                    className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-4 py-2 rounded"
                  >
                    Próxima
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {editingUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-md">
              <h2 className="text-2xl font-bold mb-4">
                Editar: {editingUser.displayName}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm mb-2">Nome de Usuário</label>
                  <input
                    type="text"
                    value={editFormData.username}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, username: e.target.value })
                    }
                    className="w-full bg-gray-700 text-white px-4 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-2">Nome de Exibição</label>
                  <input
                    type="text"
                    value={editFormData.displayName}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, displayName: e.target.value })
                    }
                    className="w-full bg-gray-700 text-white px-4 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-2">Nova Senha (deixar em branco para não alterar)</label>
                  <input
                    type="password"
                    value={editFormData.password}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, password: e.target.value })
                    }
                    className="w-full bg-gray-700 text-white px-4 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editFormData.isAdmin}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, isAdmin: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span>Administrador</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  onClick={handleUpdateUser}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
                >
                  Salvar
                </button>
                <button
                  onClick={() => setEditingUser(null)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
