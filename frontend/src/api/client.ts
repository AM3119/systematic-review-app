import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sra_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('sra_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const authApi = {
  register: (data: any) => api.post('/auth/register', data),
  login: (data: any) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  updateMe: (data: any) => api.put('/auth/me', data),
  notifications: () => api.get('/auth/notifications'),
  markNotificationsRead: () => api.put('/auth/notifications/read'),
};

// Reviews
export const reviewsApi = {
  list: () => api.get('/reviews'),
  create: (data: any) => api.post('/reviews', data),
  get: (id: string) => api.get(`/reviews/${id}`),
  update: (id: string, data: any) => api.put(`/reviews/${id}`, data),
  delete: (id: string) => api.delete(`/reviews/${id}`),
  stats: (id: string) => api.get(`/reviews/${id}/stats`),
  members: (id: string) => api.get(`/reviews/${id}/members`),
  invite: (id: string, data: any) => api.post(`/reviews/${id}/invite`, data),
  join: (id: string, token: string) => api.post(`/reviews/${id}/join`, { token }),
  removeMember: (id: string, userId: string) => api.delete(`/reviews/${id}/members/${userId}`),
  updateMemberRole: (id: string, userId: string, role: string) => api.put(`/reviews/${id}/members/${userId}/role`, { role }),
  leaderboard: (id: string) => api.get(`/reviews/${id}/leaderboard`),
  badges: (id: string) => api.get(`/reviews/${id}/badges`),
};

// Articles
export const articlesApi = {
  list: (reviewId: string, params?: any) => api.get(`/reviews/${reviewId}/articles`, { params }),
  create: (reviewId: string, data: any) => api.post(`/reviews/${reviewId}/articles`, data),
  get: (reviewId: string, articleId: string) => api.get(`/reviews/${reviewId}/articles/${articleId}`),
  update: (reviewId: string, articleId: string, data: any) => api.put(`/reviews/${reviewId}/articles/${articleId}`, data),
  delete: (reviewId: string, articleId: string) => api.delete(`/reviews/${reviewId}/articles/${articleId}`),
  import: (reviewId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/reviews/${reviewId}/articles/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  detectDuplicates: (reviewId: string) => api.post(`/reviews/${reviewId}/articles/detect-duplicates`),
  duplicateGroups: (reviewId: string) => api.get(`/reviews/${reviewId}/duplicate-groups`),
  setDuplicate: (reviewId: string, articleId: string, data: any) => api.put(`/reviews/${reviewId}/articles/${articleId}/duplicate`, data),
  tags: (reviewId: string) => api.get(`/reviews/${reviewId}/tags`),
  createTag: (reviewId: string, data: any) => api.post(`/reviews/${reviewId}/tags`, data),
  addTag: (reviewId: string, articleId: string, tagId: string) => api.post(`/reviews/${reviewId}/articles/${articleId}/tags`, { tag_id: tagId }),
  removeTag: (reviewId: string, articleId: string, tagId: string) => api.delete(`/reviews/${reviewId}/articles/${articleId}/tags/${tagId}`),
};

// Screening
export const screeningApi = {
  decide: (reviewId: string, data: any) => api.post(`/reviews/${reviewId}/screen`, data),
  progress: (reviewId: string) => api.get(`/reviews/${reviewId}/screen/progress`),
  conflicts: (reviewId: string) => api.get(`/reviews/${reviewId}/conflicts`),
  resolveConflict: (reviewId: string, conflictId: string, data: any) => api.post(`/reviews/${reviewId}/conflicts/${conflictId}/resolve`, data),
  decisions: (reviewId: string, params?: any) => api.get(`/reviews/${reviewId}/decisions`, { params }),
};

// Extraction
export const extractionApi = {
  fields: (reviewId: string) => api.get(`/reviews/${reviewId}/extraction/fields`),
  createField: (reviewId: string, data: any) => api.post(`/reviews/${reviewId}/extraction/fields`, data),
  updateField: (reviewId: string, fieldId: string, data: any) => api.put(`/reviews/${reviewId}/extraction/fields/${fieldId}`, data),
  deleteField: (reviewId: string, fieldId: string) => api.delete(`/reviews/${reviewId}/extraction/fields/${fieldId}`),
  getData: (reviewId: string, articleId: string) => api.get(`/reviews/${reviewId}/extraction/${articleId}`),
  saveField: (reviewId: string, articleId: string, data: any) => api.post(`/reviews/${reviewId}/extraction/${articleId}`, data),
  saveBulk: (reviewId: string, articleId: string, fields: any[]) => api.post(`/reviews/${reviewId}/extraction/${articleId}/bulk`, { fields }),
  summary: (reviewId: string) => api.get(`/reviews/${reviewId}/extraction/summary`),
};
